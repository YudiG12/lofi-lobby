# Guia de Hardening e Segurança — Lofi Lobby

Este documento registra a análise técnica de segurança do **Lofi Lobby** (`worker/index.js`, `worker/moderation.js`, `src/`, `index.html`, `public/stats.html`, `wrangler.toml`) e fornece especificações detalhadas de implementação para um desenvolvedor sênior aplicar os itens pendentes.

> **Status do Item 1 (Pré-`hello` / Ghost Players):** **Corrigido.** A máquina de estados do handshake WebSocket (`!p.joinedAt && m.t !== "hello"`), a remoção do fallback `createOther(m)` no handler `pos` em `src/main.js` e a expiração de sockets pré-`hello` via `HELLO_TIMEOUT_MS` (15 s) no `alarm()` já foram aplicadas e documentadas no [ADR 006](adr/006-reliable-disconnect-and-stale-socket-cleanup.md).

## Regra de Documentação (ADR obrigatório)

Para **cada solução implementada** a partir deste guia, o desenvolvedor deve:
1. **Gerar um ADR correspondente em `docs/adr/`** (seguindo a numeração sequencial e o padrão dos arquivos `docs/adr/001`–`006`, com *Context*, *Decision*, *Alternatives considered* e *Consequences*).
2. **Referenciar o novo ADR** na tabela *Architecture* do [README.md](../README.md), mantendo as linhas de ADR em **ordem crescente de numeração** (`ADR 001`, `002`, `003`, ..., antes de referências não-ADR como `SECURITY.md`).
3. **Atualizar o [SECURITY.md](../SECURITY.md)** (caso altere limites, controles ou garantias públicas) e marcar o item correspondente como concluído neste documento.

---

## Resumo Executivo e Roadmap de Priorização

A aplicação adota uma arquitetura enxuta em Cloudflare Workers + Durable Objects (`Room`, sala única `"lobby"`), sem contas de usuário, usando `textContent` para renderização no DOM e comparação em tempo constante (`equal()`) para senhas/tokens. O `npm audit` não reporta vulnerabilidades conhecidas nas dependências.

Os riscos remanescentes concentram-se em: **(a)** resiliência contra DoS e exaustão de recursos no Durable Object único, **(b)** proteção da credencial administrativa e endpoints HTTP contra força bruta/abuso de headers, **(c)** atomicidade de escrita no storage do Durable Object, e **(d)** defesa em profundidade no navegador e na moderação de texto.

| Prioridade | Item | Severidade | Alvo Principal |
|---|---|---|---|
| **P1 (Imediata)** | Item 2 — Limite real de corpo HTTP (`readBodyLimited`) | Alta | `worker/index.js` |
| **P1 (Imediata)** | Item 5 — Race condition (TOCTOU) em `POST /api/notes` | Média | `worker/index.js` |
| **P1 (Imediata)** | Item 6 — Security Headers HTTP (`_headers` + CSP + `X-Frame-Options`) | Média | `public/_headers`, `worker/index.js` |
| **P2 (Curto prazo)** | Item 3 — Força bruta IPv6/HTTP em `checkAdmin` e proteção da senha admin | Alta | `worker/index.js`, `src/main.js`, `public/stats.html` |
| **P2 (Curto prazo)** | Item 4 — Proteção contra DoS, amplificação e vazamento de RAM/Storage no DO | Alta | `worker/index.js`, Cloudflare WAF |
| **P2 (Curto prazo)** | Item 7 — Persistência de mutes progressivos durante hibernação | Média | `worker/index.js` |
| **P3 (Hardening)** | Item 8 — Evasão de moderação (homóglifos, Zalgo, spam alternado, links) | Média | `worker/moderation.js`, `worker/index.js` |
| **P3 (Hardening)** | Item 9 — Cache de texturas no cliente e limites espaciais | Baixa | `src/main.js`, `worker/index.js` |
| **P3 (Hardening)** | Item 10 — Colisões em `tagOf` (16 bits) e HMAC em `visitorOf` | Baixa | `worker/index.js` |
| **P3 (Hardening)** | Item 11 — Consistência do mural e moderação (`open` notes, `404`, `ban` ordem, `/unban`) | Baixa | `worker/index.js` |

---

## Itens Pendentes (Especificação Técnica)

### Item 2 — Bypass de Limite de Corpo HTTP (`Content-Length`) e Risco de OOM

- **Severidade:** Alta
- **Onde no código:**
  - `worker/index.js`: `Room.notes()` — `POST /api/notes/:id/like` (linhas ~276–278), `POST /api/notes` (linhas ~306–309), `PATCH /api/notes/:id` (linhas ~332–335).
  - Comparar com `Room.leaveByBeacon()` (linhas ~823–826), que já verifica o comprimento após a leitura.
- **Causa raiz:**
  - Em `POST /api/notes/:id/like`, a validação `if (!(Number(req.headers.get("Content-Length")) <= 200))` é vulnerável quando o header `Content-Length` está ausente (comum em HTTP/2, HTTP/3 ou `Transfer-Encoding: chunked`): `req.headers.get("Content-Length")` retorna `null`, `Number(null)` avalia para `0`, e `0 <= 200` é `true`.
  - Em `POST /api/notes` e `PATCH /api/notes/:id`, mesmo quando `Content-Length` é exigido (`if (!bytes || ...)`), confia-se em um valor declarado no header (ou tamanho comprimido antes da descompressão em `req.text()`), sem limitar os bytes efetivamente lidos do stream.
- **Impacto / Vetor de abuso:** Envio de payloads arbitrariamente grandes (via streaming sem `Content-Length` ou conteúdo altamente compressível) que são carregados integralmente em memória por `await req.text()`, causando picos de CPU/memória ou OOM eviction do Durable Object único (`lobby`).
- **Plano de implementação detalhado:**
  1. Criar um helper assíncrono `readBodyLimited(req, maxBytes)` em `worker/index.js`:
     - Checar antecipadamente o header `Content-Length` se estiver presente (se `Number.isFinite(len) && len > maxBytes`, rejeitar imediatamente com `413` antes de ler o stream).
     - Se `req.body` for nulo, retornar `""` (ou `400`).
     - Ler via `const reader = req.body.getReader()`, acumulando `chunks` (`Uint8Array`) e somando `total += chunk.byteLength`.
     - Se `total > maxBytes`, chamar `await reader.cancel()` e retornar erro/sentinela mapeado para `413 Payload Too Large`.
     - Decodificar os chunks concatenados com `new TextDecoder().decode(...)` e fazer `JSON.parse`.
  2. Substituir `req.text()` + validações manuais de `Content-Length` em `like`, `POST /api/notes`, `PATCH /api/notes/:id` e `leaveByBeacon` por `readBodyLimited`.
  3. Validar `Content-Type` (`application/json`) quando aplicável nos endpoints JSON de escrita.
- **Trade-offs / Cuidados:**
  - Atenção ao `navigator.sendBeacon("/api/leave", JSON.stringify(...))`: por padrão `sendBeacon` com string envia `Content-Type: text/plain;charset=UTF-8`, portanto **não** exija `application/json` em `/api/leave`.
  - Use `byteLength` de `Uint8Array` (bytes UTF-8), não `string.length` (unidades UTF-16).
- **Como validar:** Enviar requisições HTTP `POST /api/notes/:id/like`, `POST /api/notes` e `PATCH /api/notes/:id` sem `Content-Length` (ex.: `Transfer-Encoding: chunked` ou stream HTTP/2) com corpo maior que o limite (`201` bytes / `12001` bytes) e confirmar retorno `413` sem consumo excessivo de RAM; validar também requisições normais válidas.

---

### Item 3 — Força Bruta na Senha Admin (IPv6 / Sem Rate Limit HTTP) e Exposição no `localStorage`

- **Severidade:** Alta
- **Onde no código:**
  - `worker/index.js`: `Room.stats()` (linhas ~234–238), `Room.notes()` em `POST /api/notes/:id/claim` (linhas ~358–361) e `DELETE /api/notes/:id` (linhas ~369–377), `Room.checkAdmin()` (linhas ~697–711).
  - `src/main.js`: `localStorage.getItem("admin-password")` / `localStorage.setItem("admin-password", ...)` (linhas ~2270, 2321, 2415, 2514, 2525, 2647).
  - `index.html`: checagem inicial `localStorage.getItem("admin-password")` (linha ~343).
  - `public/stats.html`: `localStorage.getItem("admin-password")` e envio como `Authorization: Bearer <password>` (linhas ~186–205).
- **Causa raiz:**
  1. As rotas HTTP (`/api/stats`, `DELETE /api/notes/:id`, `POST /api/notes/:id/claim`) chamam `this.checkAdmin(ip, password)` diretamente, **sem** passar por `this.allowed({ ip }, "other")`.
  2. O lockout (`ADMIN_ATTEMPTS = 20` para `ADMIN_LOCK_MS = 60_000`) permite ~1.200 tentativas por hora por IPv4 e usa o IP bruto como chave (`"admin-fail-v3:" + ip`). Em IPv6, um atacante com um único prefixo `/64` dispõe de $2^{64}$ endereços distintos para rotacionar a cada 20 tentativas — contornando o bloqueio indefinidamente e poluindo o storage do DO com chaves `admin-fail-v3:*` que nunca expiram.
  3. A senha mestra `ADMIN_PASSWORD` é persistida em texto puro no `localStorage` do navegador e reenviada continuamente em WebSocket e HTTP. Qualquer script de terceiros na origem (como a YouTube IFrame API em caso de comprometimento de supply-chain, extensões ou XSS futuro) tem acesso direto à senha permanente.
- **Impacto / Vetor de abuso:** Descoberta da `ADMIN_PASSWORD` via força bruta distribuída ou baseada em rotação de IPv6, resultando em tomada de controle da moderação (kick/ban de todos os jogadores), controle da rádio, leitura de `/api/stats` e deleção de notas do mural; ou roubo persistente da credencial em `localStorage`.
- **Plano de implementação detalhado:**
  1. **Normalização de IP (`ipKey(ip)`):**
     - Criar um helper `ipKey(rawIp)` que preserva IPv4 como está e normaliza endereços IPv6 para seu prefixo `/64` (expandindo grupos `::` e zerando os últimos 4 hextetos). Usar `ipKey(ip)` consistentemente em `checkAdmin`, `ban:`, `MAX_PER_IP`, `note-at:`, `buckets` e `spam` (mantendo o cuidado com NAT/CGNAT apenas nos limites de jogadores/likes se necessário, mas obrigatório para anti-brute-force).
  2. **Endurecimento de `checkAdmin()`:**
     - Aplicar rate limiting HTTP explícito antes de `checkAdmin()` (ex.: `this.allowed({ ip: key }, "auth")` com balde estrito, como 5 tokens e recarga de 0.1/s).
     - Substituir o lockout fixo por **backoff exponencial** por `ipKey` (ex.: 5 erros → 2 min; 10 erros → 15 min; 15+ erros → 1 h) e adicionar um **contador global de falhas por janela** no DO (ex.: se houver > 40 falhas globais em 5 minutos vindas de múltiplos IPs, pausar autenticações por 5 minutos, exceto se já autenticado).
     - Limpar chaves `admin-fail-v3:*` expiradas no cron `archive()`.
  3. **Substituir `ADMIN_PASSWORD` no `localStorage` por sessão temporária:**
     - Na autenticação (`{ t: "auth", password }` ou `POST /api/admin/login`), o servidor valida `ADMIN_PASSWORD` uma única vez e emite um **token de sessão curto assinado (HMAC-SHA256)** com chave armazenada no DO (ou derivada de `ADMIN_PASSWORD` + salt aleatório do DO) contendo `{ exp, scope }`.
     - Para ações no mural/stats (`/api/stats`, `DELETE /api/notes/:id`, `claim`), aceitar esse token via cookie `HttpOnly; Secure; SameSite=Strict` (setado por um endpoint `/api/admin/login` e limpo por `/api/admin/logout`) ou via `sessionStorage` para o WebSocket, evitando armazenar a senha mestra no navegador.
     - Para `/stats.html` e `/api/stats` em produção, recomenda-se ainda proteger a rota com **Cloudflare Access (Zero Trust)** no painel da Cloudflare.
- **Trade-offs / Cuidados:**
  - No `wrangler dev` local sobre `http://localhost`, cookies com flag `Secure` funcionam em `localhost` nos navegadores modernos, mas não em IPs HTTP puros (`127.0.0.1` pode variar entre engines); testar com `localhost` e `https://` em staging.
  - Token de sessão assinado com chave do DO invalida sessões antigas se a chave for rotacionada, o que é positivo para revogação.
- **Como validar:**
  - Testar múltiplas falhas seguidas em `/api/stats` e `DELETE /api/notes/:id` (inclusive simulando headers em testes unitários/locais de IPv6 dentro do mesmo `/64`) e confirmar acionamento do rate limit (`429`) e backoff progressivo (`401`/`429`).
  - Inspecionar `localStorage` no DevTools após login de admin e confirmar que `ADMIN_PASSWORD` não está mais armazenada ali.

---

### Item 4 — DoS no Durable Object Único (`lobby`): Lotação de Sala, Amplificação e Vazamento de Memória/Storage

- **Severidade:** Alta
- **Onde no código:**
  - `worker/index.js`: `Room` constructor (`this.buckets`, `this.noteEdits`, `this.spam` nas linhas ~209–211), `notes()` em `GET /api/notes` (linhas ~262–272) e `topNotes()` (linhas ~394–415), `archive()` (linhas ~452–457), `fetch()` upgrade WebSocket (linhas ~488–505), `leaveByBeacon()` (linhas ~822–841).
- **Causa raiz:**
  1. **Exaustão de vagas (`MAX_PLAYERS = 100`):** A verificação de `Origin` no upgrade WebSocket bloqueia apenas requisições originadas por navegadores de terceiros (CSWSH). Clientes não-browser (scripts) definem o header `Origin` livremente. Com ~34 endereços IPv4 (ou rotação IPv6 no mesmo `/64`), um atacante ocupa os 100 slots da única sala `"lobby"` e os mantém vivos indefinidamente com `"ping"`, devolvendo `503 room is full` a todos os usuários reais.
  2. **Amplificação de leitura/CPU em `GET /api/notes?sort=top` e `POST /api/leave`:** Nenhum dos dois endpoints possui rate limit. Em `topNotes()`, uma requisição sem cache pode disparar até 5 chamadas `storage.list({ limit: 100 })` mais leituras individuais de notas e objetos `likes:*`.
  3. **Vazamento de memória RAM no DO:** Os mapas `this.buckets`, `this.spam` e `this.noteEdits` apenas inserem chaves indexadas por `ip` (e só `this.buckets` remove chaves `p.id + "|"` em `leave()`). Se o DO ficar ativo continuamente (sem hibernar) recebendo tráfego de muitos IPs, esses mapas crescem sem limite até atingir o teto de 128 MB do Durable Object.
  4. **Crescimento ilimitado de Storage:** Notas nunca expiram nem têm teto de quantidade total, e chaves `admin-fail-v3:*` e `ban:*` expiradas nunca são removidas em `archive()`.
- **Impacto / Vetor de abuso:** Indisponibilidade total do jogo para jogadores legítimos, degradação de latência do broadcast em tempo real durante floods de `/api/notes`, crash/reinício forçado do Durable Object por memória, e consumo elevado de operações de leitura/gravação (billing/free-tier quota exhaustion).
- **Plano de implementação detalhado:**
  1. **Proteção na borda (Cloudflare Dashboard / WAF):**
     - Criar **WAF Rate Limiting Rules** antes da invocação do Worker/DO para `/ws/*` (ex.: máx. conexões/min por IP/ASN) e `/api/*` (ex.: máx. reqs/10s em `/api/notes` e `/api/leave`).
     - Avaliar integração de **Cloudflare Turnstile** (modo *Managed* ou *Invisible*) antes de abrir o WebSocket ou postar no mural: o Worker valida o token Turnstile na borda antes de rotear para o Durable Object `Room`, impedindo que scripts simples acordem ou lotem o DO.
  2. **Cache e Rate Limit em `GET /api/notes` e `POST /api/leave`:**
     - Adicionar rate limit por `ipKey` em `GET /api/notes` (ex.: `RATES.notesRead = [30, 2]`) e `POST /api/leave` (`[10, 1]`).
     - Cachear em memória no DO a primeira página (sem `cursor` e sem estado personalizado) de `newNotes` e `topNotes`, invalidando o cache em `POST`, `PATCH`, `DELETE` e `like` (aplicando `mine`/`liked` em memória ou apenas quando `X-Wall-Key` válido é enviado).
  3. **Eviction de RAM em `this.buckets`, `this.spam` e `this.noteEdits`:**
     - No `alarm()` (ou periodicamente a cada N operações), varrer `this.buckets`, `this.spam` e `this.noteEdits` removendo entradas inativas há mais de 30–60 minutos (e sem mute ativo).
     - Definir um teto defensivo (ex.: `MAX_MAP_ENTRIES = 5000`), descartando as entradas mais antigas caso seja excedido.
  4. **Higiene de Storage em `archive()`:**
     - Estender `Room.archive()` para varrer e remover em lotes de 128 chaves:
       - `ban:*` cujo valor (`until`) `< now`.
       - `admin-fail-v3:*` cujo `until > 0 && until < now` (e opcionalmente guardar `lastAt` para expirar contadores parciais antigos após 24h).
       - `names:*` cujas entradas todas expiraram (`> NAMES_MS`).
     - Definir uma política de capacidade ou arquivamento para o mural de notas caso ultrapasse um limite operacional (ex.: 10.000 notas ou limite por tamanho de storage).
- **Trade-offs / Cuidados:**
  - Turnstile adiciona uma chamada de verificação na borda; manter o widget invisível para não prejudicar a UX de entrada rápida.
  - Ao limpar `this.spam` em memória, certifique-se de respeitar a janela `STRIKE_RESET_MS` (e persistir mutes reais conforme Item 7).
- **Como validar:** Simular rajadas de `GET /api/notes?sort=top` e verificar respostas `429` após estouro do balde; testar `alarm()` e `archive()` localmente com registros expirados simulados confirmando a remoção de chaves antigas de RAM e storage.

---

### Item 5 — Race Condition (TOCTOU) em `POST /api/notes`

- **Severidade:** Média
- **Onde no código:**
  - `worker/index.js`: `Room.notes()` — handler `POST /api/notes` (linhas ~303–329).
- **Causa raiz:**
  - O comentário na linha 304 afirma que nada faz `await` entre a leitura de rate limit e a escrita, mas a lógica atual lê `[ban, last, count]` na linha 319 e, **depois**, executa `const owner = await ownerOf(m.key)` na linha 323 (`crypto.subtle.digest` é assíncrono e **não** pertence à fila de storage, liberando o *input gate* do Durable Object).
  - Requisições concorrentes do mesmo IP leem o mesmo `last` antigo e o mesmo `count` antes de qualquer uma concluir o `storage.put` na linha 326.
- **Impacto / Vetor de abuso:**
  - Bypass do limite de 1 nota por minuto por IP (`NOTE_EVERY_MS`) enviando requisições simultâneas em rajada.
  - Corrupção de `"note-count"` (incrementos perdidos por *lost update*).
- **Plano de implementação detalhado:**
  1. Em `POST /api/notes`, mover `const owner = await ownerOf(m.key);` para **antes** de `Promise.all([storage.get(...)])` (junto com a validação de texto e `badName`).
  2. Encapsular a leitura e gravação críticas (`ban`, `lastKey`, `note-count`, `[id]`) dentro de `await this.state.storage.transaction(async (txn) => { ... })` — garantindo atomicidade mesmo que surjam outros `await` no futuro.
  3. Aplicar o mesmo padrão `storage.transaction()` em `POST /api/notes/:id/like` e `DELETE /api/notes/:id` para proteger `note-count` e o índice `top:*` contra corridas entre `like`, `PATCH` e `DELETE` simultâneos.
  4. Disparar `this.broadcast(...)` apenas após a transação confirmar sucesso.
- **Trade-offs / Cuidados:**
  - Transações no Durable Object não devem conter chamadas externas (`fetch`, `crypto` se evitável); faça toda validação e hashing **antes** de entrar na transação.
- **Como validar:** Disparar 5 requisições `POST /api/notes` simultâneas (`Promise.all`) a partir do mesmo IP e confirmar que exatamente 1 retorna `200`, as demais retornam `429`, e `"note-count"` aumenta em exatamente `1`.

---

### Item 6 — Ausência de Security Headers HTTP (Clickjacking, CSP e Isolamento)

- **Severidade:** Média
- **Onde no código:**
  - `wrangler.toml` (`[assets]`, `run_worker_first`)
  - `worker/index.js`: `fetch()` (linhas ~876–913) e respostas JSON/HTML.
  - `index.html`: fontes Google (`fonts.googleapis.com`) e `<script type="module">`.
  - `src/radio.js`: carregamento dinâmico de `https://www.youtube.com/iframe_api` (linhas ~31–33) e miniaturas `https://i.ytimg.com/...` (linha ~132).
  - `public/stats.html`: `<script>` inline (linha ~74) e Google Fonts (linha ~9).
- **Causa raiz:**
  - Nenhuma resposta de assets estáticos (`dist/`) ou de API (`/api/*`) inclui `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` ou `Strict-Transport-Security`.
- **Impacto / Vetor de abuso:**
  - **Clickjacking:** Um site externo pode embutir `/` ou `/stats.html` em um `<iframe>` invisível e enganar um administrador autenticado para clicar em kick/ban ou exclusão de notas.
  - **Ausência de defesa em profundidade contra XSS:** Sem `CSP`, caso surja qualquer vetor de injeção no futuro, scripts arbitrários podem exfiltrar `wall-key` (ou tokens de sessão) e interagir livremente com origens externas.
- **Plano de implementação detalhado:**
  1. Criar `public/_headers` (processado automaticamente pelo Cloudflare Workers Static Assets) aplicando para `/*`:
     - `X-Frame-Options: DENY`
     - `X-Content-Type-Options: nosniff`
     - `Referrer-Policy: strict-origin-when-cross-origin`
     - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
     - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  2. Adicionar uma `Content-Security-Policy` testada para não quebrar Three.js, YouTube IFrame API, mural nem `/stats.html`:
     - Mover os `<script>` e `<style>` inline de `index.html` e `public/stats.html` para módulos JS/CSS externos (permite remover `'unsafe-inline'` de `script-src`, que hoje seria exigido pelos scripts inline atuais).
     - Diretivas recomendadas após externalizar scripts:
       - `default-src 'self'`
       - `script-src 'self' https://www.youtube.com https://s.ytimg.com`
       - `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` (ou remover `fonts.googleapis.com` hospedando `Silkscreen` e `Pixelify Sans` localmente em `public/fonts/`)
       - `font-src 'self' https://fonts.gstatic.com` (ou `'self'` com fontes locais)
       - `img-src 'self' data: blob: https://i.ytimg.com`
       - `frame-src https://www.youtube.com https://www.youtube-nocookie.com`
       - `connect-src 'self' wss: ws:` (em produção usar `wss:` apenas; em dev permitir `ws:`)
       - `object-src 'none'`
       - `base-uri 'self'`
       - `form-action 'self'`
       - `frame-ancestors 'none'`
  3. No `worker/index.js`, envolver todas as respostas retornadas pelo Worker (`/api/*`) com esses mesmos headers defensivos (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store`).
- **Trade-offs / Cuidados:**
  - Three.js (`FBXLoader` / `TextureLoader` / `CanvasTexture`) usa `blob:`/`data:` em alguns fluxos internos de textura; manter `img-src 'self' data: blob:`.
  - A API do YouTube carrega sub-scripts de `s.ytimg.com` e cria iframe em `www.youtube.com`. Testar reprodução da rádio e exibição de capa após ativar CSP.
- **Como validar:** Verificar headers via `curl -I` na URL publicada/preview, testar carregamento completo do jogo (FBX, texturas, rádio YouTube, mural, `/stats.html`) com DevTools Console aberto garantindo zero violações de CSP, e testar tentativa de embedding em `<iframe>` externo confirmando bloqueio.

---

### Item 7 — Reset de Mutes Progressivos na Hibernação do Durable Object

- **Severidade:** Média
- **Onde no código:**
  - `worker/index.js`: `Room` constructor (`this.spam` na linha ~211), `spamOf()` (linhas ~772–777), `strike()` (linhas ~779–792), `webSocketMessage()` handler `chat` (linhas ~666–672).
- **Causa raiz:** Todo o estado de `this.spam` (strikes e `mutedUntil` de até 30 minutos) e `this.noteEdits` reside exclusivamente em memória RAM. Quando o Durable Object hiberna (após inatividade) ou é reciclado pela plataforma, o histórico de spam é zerado.
- **Impacto / Vetor de abuso:** Usuários mutados por spam podem contornar mutes de 5–30 minutos apenas aguardando o DO hibernar (ou forçando desconexão quando a sala fica vazia).
- **Plano de implementação detalhado:**
  1. Continuar mantendo a checagem rápida em RAM (`this.spam`) para evitar leituras de storage em toda mensagem normal.
  2. Quando `strike()` aplicar um mute real (`ms > 0`), gravar no storage `mute:${ipKey(ip)}` com `{ until: s.mutedUntil, strikes: s.strikes, lastStrike: now }`.
  3. No handler de `chat` (ou em `spamOf` tornado assíncrono quando houver cache miss em `this.spam`), carregar `mute:${ipKey(ip)}` do storage caso o IP não esteja no mapa em memória — restaurando `strikes` e `mutedUntil` após hibernação.
  4. Incluir limpeza de chaves `mute:*` expiradas (`now - lastStrike > STRIKE_RESET_MS && until < now`) dentro do cron `archive()`.
- **Trade-offs / Cuidados:** Gravar no storage apenas quando `ms > 0` (a partir do 2º strike) mantém zero escritas extras para usuários normais e minimiza custo de storage.
- **Como validar:** Aplicar mute em um cliente de teste, reiniciar `wrangler dev` (ou forçar eviction/restart do DO) e verificar que o mesmo IP continua mutado pelo tempo restante ao tentar enviar `chat`.

---

### Item 8 — Evasão de Moderação (Homóglifos, Impersonation, Zalgo Text, Spam Alternado e Links)

- **Severidade:** Média
- **Onde no código:**
  - `worker/moderation.js`: `normalize()` (linhas ~8–15), `badName()` (linhas ~49–53), `cleanChat()` (linhas ~56–59), `hasLink()` (linhas ~65–71).
  - `worker/index.js`: `cleanText()` (linhas ~116–121), `cleanNote()` (linhas ~123–134), `nameFor()` (linhas ~681–689), anti-spam de `chat` (linhas ~669–672).
- **Causa raiz:**
  1. `normalize()` remove tudo fora de `[a-z0-9]` após `NFD`, sem converter homóglifos de outros alfabetos (ex.: letras cirílicas/gregas visualmente idênticas a `a`, `e`, `o`, `p`, `c`, `i`, `x`). Isso permite nomes como `"аdmin"` (com `а` cirílico) passarem pela checagem `/admin|moderador|moderator|staff/` e palavras proibidas passarem pelo filtro.
  2. `cleanText()` e `cleanNote()` filtram caracteres de controle e bidi, mas não removem caracteres invisíveis comuns (`\u00ad`, `\u2060`, `\u2800`, `\u3164`, `\ufeff`, `\u180e`) nem limitam marcas combinantes Unicode (`\p{M}`), permitindo *Zalgo text* que polui a UI e estoura visualmente balões e notas.
  3. O filtro anti-spam verifica apenas `text === s.lastText`, facilmente contornado alternando duas mensagens (`"oi"` / `"olá"`) ou variando um caractere por envio.
  4. `hasLink` não detecta endereços IP (`192.0.2.1` ou com porta) nem diversos TLDs comuns em spam (`.co`, `.site`, `.click`, `.shop`, `.top`, `.link`, `.live`, `.me/` com subdomínio, etc.).
- **Plano de implementação detalhado:**
  1. **Mapa de confusables em `worker/moderation.js`:**
     - Antes de remover caracteres não-ASCII em `normalize()`, aplicar `.normalize("NFKC")` e substituir um dicionário dos principais homóglifos cirílicos/gregos/matemáticos (ex.: `\u0430 -> a`, `\u0435 -> e`, `\u043e -> o`, `\u0440 -> p`, `\u0441 -> c`, `\u0445 -> x`, `\u0456 -> i`, etc.).
     - Além disso, restringir nomes de jogadores em `cleanText`/`nameFor` a um conjunto seguro (ex.: latim + dígitos + espaço + `._-`), rejeitando ou limpando alfabetos mistos suspeitos.
  2. **Sanitização Unicode em `cleanText()` e `cleanNote()`:**
     - Normalizar entrada com `.normalize("NFC")`.
     - Remover invisíveis/fillers adicionais (`[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u2800\u3164\ufeff\uffa0]`).
     - Limitar marcas combinantes consecutivas: `.replace(/\p{M}{2,}/gu, (m) => m[0])` (mantém acentos legítimos, bloqueia Zalgo).
  3. **Anti-spam com janela recente:**
     - Em `this.spam`, guardar as últimas `N = 4` mensagens normalizadas com timestamp (`recent: [{ norm, at }]`) e contar repetições ou alta similaridade dentro de `REPEAT_WINDOW_MS`.
  4. **Endurecer `hasLink()`:**
     - Bloquear endereços IPv4 (`\b(?:\d{1,3}\.){3}\d{1,3}\b`), encurtadores e TLDs comuns em spam (`co`, `site`, `click`, `shop`, `top`, `link`, `live`, `club`, `icu`, `buzz`, `pro`, `me` quando precedido de ponto em contexto suspeito, mantendo a exceção de pontuação em frases quando não há `/` ou protocolo).
- **Trade-offs / Cuidados:**
  - Não bloquear acentos legítimos do português/espanhol/francês ao limitar `\p{M}`. Testar palavras acentuadas como `"coração"`, `"não"`, `"pôr"`.
  - Em `hasLink`, evitar falsos positivos em frases normais sem espaço após ponto final (conforme comentário já existente em `worker/moderation.js:63`).
- **Como validar:** Criar uma suíte de testes unitários (Node `--test`) cobrindo nomes com homóglifos de `admin`, texto Zalgo, caracteres invisíveis, spam alternado e links ofuscados vs. frases legítimas em português/inglês.

---

### Item 9 — Griefing de Performance nos Clientes (`gender`/`cap`) e Limites Espaciais

- **Severidade:** Baixa
- **Onde no código:**
  - `src/main.js`: `createOther()` (linhas ~2171–2233), handler `gender` (linhas ~2334–2353), `removeBackground()` / `recolorCap()` (linhas ~61–95, 1579–1603).
  - `worker/index.js`: `COORD_LIMIT` (linha ~67), handlers `gender`, `pos`, `sit`, `capy` (linhas ~589–633).
- **Causa raiz:**
  1. Ao receber `{ t: "gender", id, gender, cap }`, todos os clientes removem o jogador e chamam `createOther()`, que recria canvas, executa `getImageData` + `removeBackground` + `recolorCap` em todos os pixels do spritesheet e cria uma nova textura WebGL. Um usuário alternando `gender`/`cap` no limite de `other` (1/s) ou várias contas juntas causam micro-travamentos e churn de memória GPU nos navegadores de todos na sala.
  2. `COORD_LIMIT = 500` permite teleporte para muito fora da vila (`~[-50, 50]`), e `sit`/`capy` não validam distância nem cooldown mais restrito para `gender`/`name`.
- **Plano de implementação detalhado:**
  1. **Cache de texturas por variante (`gender + "|" + cap`) em `src/main.js`:**
     - Pré-processar (on-demand) cada combinação `male|0..4` e `female|0..4` (no máximo 10 canvases base).
     - Em `createOther()`, clonar apenas um `THREE.CanvasTexture(cachedCanvas)` leve (ou compartilhar a `image` já recolorida sem reexecutar `removeBackground`/`recolorCap`), atualizando `tex.repeat`/`tex.offset` por jogador.
  2. **Rate limits granulares e limites do mapa em `worker/index.js`:**
     - Adicionar baldes específicos para `gender`/`name` (ex.: `[4, 0.25]` — rajada de 4 trocas, 1 a cada 4 s).
     - Reduzir `COORD_LIMIT` para o limite real do mapa (ex.: `65` — checar `townBox` em `src/main.js` antes de ajustar).
     - Como melhoria opcional para `sit`: verificar se a posição atual `p.x, p.z` está dentro de um raio razoável do banco (ou apenas manter a exclusividade atual já que movimento é client-side por design no ADR 001).
- **Trade-offs / Cuidados:** `tex.repeat` e `tex.offset` são propriedades por instância de `THREE.Texture`; portanto, cada jogador continua com seu próprio `THREE.Texture` apontando para o **mesmo `HTMLCanvasElement` cacheado** (evitando recomputação de pixel e mantendo offsets independentes por frame de animação).
- **Como validar:** Trocar gênero/boné repetidamente em uma aba e observar na outra aba via Performance/Memory Profiler do Chrome que `recolorCap`/`removeBackground` rodam no máximo 1 vez por combinação `(gender, cap)`.

---

### Item 10 — Colisões em `tagOf` (16 bits) e Reversibilidade de `visitorOf`

- **Severidade:** Baixa
- **Onde no código:**
  - `worker/index.js`: `visitorOf()` (linhas ~168–172) e `tagOf()` (linhas ~744–752).
- **Causa raiz:**
  1. `tagOf(ip)` trunca o HMAC para apenas 2 bytes (4 caracteres hex = 65.536 valores). Pelo paradoxo do aniversário, após ~300 IPs distintos já existe probabilidade relevante de colisão. Como `tagOf` é usado como chave de `"names:" + tag` e na comparação de `LIKES_PER_IP`, colisões podem misturar históricos de nomes no menu `/who` (induzindo o admin a banir usuário inocente) ou bloquear likes legítimos.
  2. `visitorOf(ip)` calcula `SHA-256(ip + "|" + day)` **sem segredo**. Se os dados do Analytics Engine (`blob4`) forem acessados, qualquer endereço IPv4 no conjunto (~$4.29 \times 10^9$) pode ser revertido por força bruta com hash table/GPU.
- **Plano de implementação detalhado:**
  1. Aumentar `tagOf(ip)` para retornar pelo menos 6 bytes (12 chars hex) para chaves internas (`names:${tag}` e valores em `likes:${id}`), exibindo apenas os primeiros 4–6 caracteres na UI do admin se desejar brevidade visual. (Atenção: ao alterar o formato, chaves antigas `names:<4hex>` caducam naturalmente em `NAMES_MS = 6h`).
  2. Alterar `visitorOf(ip)` para usar **HMAC-SHA256** com uma chave secreta (ex.: a própria `tagKey` armazenada no DO, ou um segredo derivado rotacionado diariamente no storage) em `ip + "|" + day`.
- **Trade-offs / Cuidados:** Mudar `visitorOf(ip)` altera a forma como visitantes únicos do dia atual são contabilizados no Analytics Engine durante o dia da virada de deploy (efeito pontual de 1 dia).
- **Como validar:** Verificar o tamanho da string retornada por `tagOf` e `visitorOf` e confirmar que `names:` e `/who` continuam exibindo corretamente no menu do admin.

---

### Item 11 — Pequenas Inconsistências no Mural de Notas e na Moderação

- **Severidade:** Baixa
- **Onde no código:**
  - `worker/index.js`:
    - `POST /api/notes` (linhas ~323–324): `...(owner && { owner })`
    - `DELETE /api/notes/:id` (linhas ~369–383)
    - `Room.moderate()` (linhas ~714–740)
- **Causa raiz e correções:**
  1. **Notas novas sem `owner` (`open: true`):** Em `POST /api/notes`, se o cliente omitir `key` (ou mandar `key` inválida), `ownerOf(m.key)` retorna `null` e a nota é salva sem `owner`, ficando marcada como `open: true` (recurso legado para notas anteriores às wall keys) e permitindo que seja reivindicada via `/claim`. **Correção:** se `!owner`, retornar `400` em `POST /api/notes` (exigir wall key válida de 32 hex chars em todas as notas novas).
  2. **`DELETE /api/notes/:id` em nota inexistente:** Quando o admin envia `DELETE` para um `id` que não existe, o código na linha 379–381 ainda chama `delete(["likes:...", "top:..."])` e faz `this.broadcast({ t: "note-del", ... })`. **Correção:** após checar permissão/admin, se `!note`, retornar `json({ error: "this note is gone" }, 404)`.
  3. **Ordem de gravação de ban em `moderate()`:** Em `moderate()`, `saveHistory()` (com `await` na linha 729) ocorre **antes** de gravar `"ban:" + ip` no storage (linha 731) e antes de desconectar os sockets (linha 736). Se o alvo abrir uma nova conexão WebSocket durante o `await` de `saveHistory()`, a checagem de ban em `fetch()` pode não vê-lo ainda. **Correção:** gravar `"ban:" + ip` e fechar os sockets **antes** de filtrar e salvar `history()`.
  4. **Granularidade de `/unban`:** Atualmente `/unban` apaga **todos** os bans da sala de uma vez. **Sugestão:** aceitar `/unban <tag>` (armazenando `{ until, tag }` ou índice `ban-tag:<tag>`) mantendo `/unban all` apenas como opção explícita.
- **Como validar:**
  - Enviar `POST /api/notes` sem `key` e confirmar `400`.
  - Enviar `DELETE /api/notes/note:000000000000000-aaaaaa` autenticado como admin e confirmar `404` sem evento `note-del` no WebSocket.
  - Banir um usuário ativo e tentar reconectar imediatamente em paralelo confirmando `403 banned`.
