# War of the Crowns — Training Plan Deck Finder

Tick the training plan cards you own; get the strongest five-card decks you can
actually build.

**Live:** https://greatluke.github.io/WftC-simulation/

All 42,504 possible decks (`C(24,5)`) are scored ahead of time, so the page filters
them to your collection instantly and entirely in your browser. Nothing is uploaded
and there is no backend.

## What it shows

- **Top 5 / 10 / 20** decks buildable from the cards you ticked.
- **Average power** — the mean over all 120 card orders. Card order is randomised
  each session, so this is what you actually experience over time, and the number
  worth optimising. Decks containing Destiny assume you pick its best re-trigger
  target, since that target is your choice rather than a roll.
- **Max roll** — the highest result seen in simulation. Mostly luck; good for
  chasing a one-off record, bad for picking a deck.
- **Worst case** — the lowest result, for when you need to clear a threshold every
  single time.
- **Best card to chase next** — of the cards you don't own, which one would raise
  your best deck the most, and by how much.

Your selection is saved in the browser and encoded in the URL, so "Copy shareable
link" hands someone your exact collection.

## Where the numbers come from

A reverse-engineered simulator that reimplements all 24 card effects, then evaluates
every deck across every card order. Its output has been checked against real in-game
training results: it reproduces every measured minimum exactly and most measured
maxima exactly, and no measured result is beyond what it can produce. (Where it
disagrees, it finds a *higher* ceiling than the game has shown — the game simply had
not rolled that high yet.)

It is a strong guide, not gospel. If a deck's real numbers differ from what you see
here, please open an issue with the deck and the in-game min/max — that is exactly
the data that improves the model.

## Running it locally

Clone and open `index.html`. There is no build step and no server needed —
`data.js` loads via `<script src>` rather than `fetch`, so `file://` works fine.

## Files

```
index.html   the entire app
data.js      generated: 42,504 scored decks + card metadata
```

Unaffiliated with the game or its developers.
