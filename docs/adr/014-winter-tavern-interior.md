# 014. Shared winter tavern interior

The front door of the first house on the right opens a walkable tavern. The interior uses a reserved region of the existing scene, centered at x = 200, outside the outdoor town and within the Worker's existing coordinate limits. Existing position and chat messages let people in the same lobby see and talk to each other inside. The camera follows the existing avatar and changes its background and fog while indoors.

Twelve numbered seats extend the existing seat range to 37–48. The client keeps the corresponding seat positions and collision geometry. The house door remembers where the player entered, and the browser saves the outdoor position so a reload always has a safe place to start.

The bartender's rotating conversation and serving animation run locally. Receiving a drink uses the existing held cup state, which the room already synchronizes.
