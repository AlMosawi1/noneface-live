# Domino Multiplayer Game Rules

## Game Modes

The game supports:

- 1v1
- 2v2

The host chooses the mode before starting the game.

## Room Creation

- A player can click **Host a Game**.
- The system creates a room with a random 6-character code.
- The code uses numbers and letters only.
- Other players join using **Join a Game** and entering the code.

## Display Names

- Every player enters a display name before joining.
- The display name is shown in the room and during the game.

## Host Controls

The host can:

- Start the game
- Kick players from the room
- Ban players from the room
- Set the starting entry score
- Set the winning score

If a player is banned, they cannot rejoin the same room.

## Round Start Rule

### First Round

- The player who has the 6/6 domino starts.

### Later Rounds

- The player who finished their hand first in the previous round starts the next round.

### Blocked Round / No Legal Plays

If no player can make a legal move:

- The player who placed the last domino starts the next round.
- Each team sums the values of all remaining dominoes in their hands.
- The team with the higher remaining total loses the round.
- The winning team receives points equal to the losing team's remaining total.

Example:

Team A remaining dominoes:

- 1/1 = 2
- 2/1 = 3
- 6/6 = 12

Total = 17

Team B remaining dominoes:

- 5/5 = 10
- 0/6 = 6

Total = 16

Team A has the higher total, so Team A loses. Team B receives 17 points.

## Scoring

- The host sets the starting entry score.
- Example: starting entry = 21.
- Points count toward the game total only after the starting entry condition is met.
- The host sets the winning score.
- Example: game ends at 100 points.

## Technical Notes

This requires a backend server because the game is live multiplayer.

Recommended stack:

- Frontend: HTML, CSS, JavaScript hosted on GitHub Pages
- Backend: Node.js + Socket.IO
- Optional database later for accounts, bans across sessions, match history, and leaderboard
