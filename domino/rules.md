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

## Five doubles redraw

- If any player is dealt **five or more doubles** at the start of a round, a **redraw vote** runs before play begins. That player does not vote.
- In **2v2**, if **two** of the other three players vote to redraw, all tiles are collected and redealt (the vote may run again if the new deal also qualifies).
- In **1v1**, only the **opponent** votes; their agreement alone is enough to force a redraw.

## Round Start Rule

### First Round

- The player who has the 6/6 domino starts.

### Later Rounds

- The player who finished their hand first in the previous round starts the next round.

### Blocked Round / No Legal Plays

If no player can make a legal move:

- The player who placed the last domino starts the next round.
- Each team sums the values of all remaining dominoes in their hands.
- The team with the higher remaining total loses the round (for loss scoring).
- That losing team’s pip total may be added to their **loss score** (see Scoring).

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

Team A has the higher total, so Team A loses the blocked round for scoring purposes.

## Go-out (empty hand)

When a player places their last domino and **empties their hand**, the round ends immediately.

- The **opposing team** has all remaining tiles; sum the pips on those tiles.
- That pip total is added to the opposing team’s **loss score** only if it is **greater than or equal to** the host’s **starting entry** threshold (same rule as a blocked round).
- The player who went out **starts the next round**.
- If that loss update pushes the opposing team to the **loss cap**, that team loses the match.

## Scoring

- The host sets the **starting entry** pip threshold (for example 21).
- On a **blocked round**, the losing team’s remaining pip total is added to that team’s **loss score** only if that total is **greater than or equal to** the starting entry; otherwise nothing is added for that round.
- The same entry rule applies when someone **goes out** (see above).
- The host sets the **loss cap** (for example 100). Each team’s loss score is shown as `current / cap`.
- When a team’s loss score reaches the cap, **that team loses the match**.

## Technical Notes

This requires a backend server because the game is live multiplayer.

Recommended stack:

- Frontend: HTML, CSS, JavaScript hosted on GitHub Pages
- Backend: Node.js + Socket.IO
- Optional database later for accounts, bans across sessions, match history, and leaderboard
