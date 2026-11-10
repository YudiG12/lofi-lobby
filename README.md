# Sala Lo-fi

Uma vila 2.5D online pra ficar de fundo enquanto você estuda ou trabalha: todo mundo
anda pela mesma cidade à noite, conversa por chat (com balão em cima do personagem) e
ouve a **mesma música no mesmo segundo**, controlada pelo sistema, como uma rádio.

Projeto pessoal, feito pra aprender na prática tempo real com Cloudflare Workers +
Durable Objects e renderização 2.5D com three.js.

## O que tem

- **Cena 2.5D com three.js**: sprites em pé dentro de um mundo 3D, câmera inclinada,
  noite com postes de luz que iluminam e projetam sombra dinâmica (inclusive do personagem).
- **Oclusão estilo 2.5D**: o sprite inteiro usa a profundidade dos pés (no shader), então
  objetos na frente cobrem o personagem todo e nada atrás corta a cabeça dele.
- **Colisão**: degraus de terreno por raycast, caixas sólidas, lago com caixa reta.
- **Água animada**: shader injetado no material Phong (ondas na normal + cintilação).
- **Multiplayer**: um Durable Object por sala, WebSocket com hibernação.
- **Rádio sincronizada**: player do YouTube sem controles; a posição vem do relógio
  (ou do último comando de admin guardado no Durable Object), então todo mundo ouve o
  mesmo trecho. Admin pode voltar/pular com senha.
- **Chat** com balão, **nome** em cima de cada treinador, troca de **gênero** (tecla G).

## Arquitetura

```
navegador ──HTTP──▶ Worker ──▶ assets estáticos (build do Vite)
          ──WS /ws/<sala>──▶ Worker ──▶ Durable Object "Sala" (1 por sala)
                                         ├─ estado de cada jogador no próprio socket
                                         │  (serializeAttachment → sobrevive à hibernação)
                                         └─ comando da rádio no storage do DO
```

Protocolo (JSON) documentado no topo de [`worker/index.js`](worker/index.js).

## Segurança

O cliente é público, então o servidor não confia em nada que vem dele:

- limite de tamanho por mensagem (1 KB) e **limite de taxa** por conexão (posição, chat, resto);
- **máximo de jogadores** por sala;
- **origem** do WebSocket conferida (só o próprio site ou origens em `ORIGENS`);
- senha de admin só no servidor (segredo `ADMIN_SENHA`), comparação em **tempo constante**
  e poucas tentativas por conexão;
- texto de nome e chat limpo de caracteres de controle/bidi e cortado; coordenadas só
  números finitos e limitados;
- no navegador, todo texto vindo da rede entra com `textContent` (nada de HTML).

## Rodando local

```bash
npm install
echo "ADMIN_SENHA=$(openssl rand -hex 8)" > .dev.vars
echo "ORIGENS=http://localhost:5173" >> .dev.vars

npx wrangler dev --port 8787   # servidor das salas
npx vite                       # site em http://localhost:5173
```

- Outra sala: `?sala=nome`
- Modo admin da rádio: abra uma vez com `?admin=<sua senha>`
- Controles: setas/WASD andam, Enter abre o chat, G troca o treinador.

## Assets

O repositório só tem código. A vila e os treinadores padrão são **gerados no código**
(low-poly e pixel art originais). A pasta `public/assets/` é **ignorada pelo Git e pelo
build**: ela existe pra você testar localmente com modelos e sprites próprios
(configuração no topo de [`src/main.js`](src/main.js): `CIDADE`, `SHEETS`, `RECORTE`).
Se os arquivos não existirem, o jogo usa os originais automaticamente.

## Deploy (Cloudflare)

```bash
npx vite build
npx wrangler secret put ADMIN_SENHA
npx wrangler deploy
```

## Stack

three.js · Vite · Cloudflare Workers · Durable Objects (WebSocket Hibernation API) · YouTube IFrame API
