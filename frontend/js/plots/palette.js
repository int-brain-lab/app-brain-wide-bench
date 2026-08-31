// The ink a chart's marks are drawn in.
//
// Six hues, which is one more than the model comparison allows (MAX_MODELS) and exactly the
// task comparison's cap (MAX_COMPARED) — so colour alone carries identity, and no chart needs
// a second channel. A score keeps its hue whether it shares a plot with the others or has one
// of its own, so the same result is the same colour in every view of it.
//
// Measured all-pairs on a white surface, the pairlist a dot plot needs where any two series
// can end up side by side. Worst separation is ΔE00 22.7 in normal vision and 7.6 under
// deuteranopia — the latter is the blue/purple pair, which the four-colour palette this
// replaced already had. Under protanopia orange and amber are the close pair, at 8.4, and a
// reader there uses the legend to separate those two.
const SERIES_COLOURS = [
  "#2a78d6",
  "#e2601f",
  "#1baf7a",
  "#4a3aa7",
  "#b8860b",
  "#7a4420",
];

// What a mark is drawn in when the panel, not the hue, says which score it is.
const SERIES_INK = SERIES_COLOURS[0];

// The hue of the nth series where several share one panel. Past the sixth the hues start
// again, which the comparison caps prevent.
function seriesColour(index) {
  return SERIES_COLOURS[index % SERIES_COLOURS.length];
}

// Magnitude, not identity: one hue from light to dark, because a quantity has an order and
// a set of hues does not — a rainbow ramp invents boundaries where the data has none. Five
// steps rather than a continuous wash, so a reader can match a cell against a key instead
// of guessing at a shade.
//
// The blue is the app's own TS2 family, extended at both ends: light enough that the bottom
// step still reads as a value rather than as an empty cell, dark enough that the top step
// is unmistakably the top.
const SEQUENTIAL = ["#e6f1fb", "#b9d6f3", "#7fb1e6", "#4a89d4", "#245f9e"];

export { SEQUENTIAL, SERIES_COLOURS, SERIES_INK, seriesColour };
