// The ink a chart's marks are drawn in.
//
// Six hues, which is every cap in the app — MAX_MODELS, MAX_SUBMISSIONS, MAX_COMPARED — so
// colour alone carries identity and no chart needs a second channel. One per slot, and a pick
// holds its slot for as long as it is held: see slotFor in comparisons/picks.js.
//
// Measured all-pairs on a white surface, since any two series can end up side by side. Worst
// separation is ΔE00 22.7 in normal vision and 7.6 under deuteranopia, the blue/purple pair.
// Under protanopia orange and amber are the close pair, at 8.4.
const SERIES_COLOURS = ["#2a78d6", "#e2601f", "#1baf7a", "#4a3aa7", "#b8860b", "#7a4420"];

// Magnitude, not identity: one hue from light to dark, so the ramp has the order a quantity
// has. Ten steps rather than a continuous wash, so a cell can be matched against the key.
// Every heatmap here spans 0 to 1, so a step is a tenth.
//
// The bottom step still reads as a value; an absent one is `.heat-empty` in style.css.
const SEQUENTIAL = [
  "#e6f1fb",
  "#d2e5f7",
  "#bed9f4",
  "#a6caef",
  "#8cb9e9",
  "#73a8e2",
  "#5c96da",
  "#4684ce",
  "#3572b6",
  "#245f9e",
];

export { SEQUENTIAL, SERIES_COLOURS };
