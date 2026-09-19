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

export { SERIES_COLOURS };
