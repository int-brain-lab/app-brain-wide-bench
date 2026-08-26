// The ink a chart's marks are drawn in.
//
// There is one, and that is the finding rather than a shortcut. Colour can carry identity
// for at most four series: these four clear every all-pairs floor of the palette checks on
// a white surface — the pairlist a dot plot needs, where any two series can end up side by
// side — and no five-colour candidate does. Every fifth hue tried (yellow, magenta, red,
// green) fell below the normal-vision floor against orange or aqua, a pair a full-colour
// reader cannot tell apart, which no legend rescues.
//
// So a comparison of eight scores doesn't colour them. It gives each its own panel and puts
// the name on the panel — see charts/recordingChart.js — and every mark takes the first
// colour below. The rest are kept for a chart that overlays four or fewer series, where
// colour is the right encoding and these are the ones to use, in this order.
const SERIES_COLOURS = ["#2a78d6", "#eb6834", "#1baf7a", "#4a3aa7"];

// What a mark is drawn in when the panel, not the hue, says which score it is.
const SERIES_INK = SERIES_COLOURS[0];

// Past the fourth series the hue starts again and the marker changes shape instead. That
// is composite encoding — the sanctioned way past the colour ceiling, and the only one that
// doesn't invent a fifth hue nobody can name. It works here because the legend draws its
// swatch in the series' own point style, so both channels are in the key rather than only
// the colour.
const SERIES_SHAPES = ["circle", "triangle"];

/**
 * The look of the nth series where several share one panel.
 *
 * @returns { colour, pointStyle, repeat } — eight distinguishable combinations, which is
 *          where the comparison's own cap comes from. `repeat` is how many times the hues
 *          have come round: 0 for the first four series, 1 for the next four. A dot says so
 *          with its shape, but a bar has no shape to change, so a mark that can't be
 *          reshaped is hatched instead — see `hatch` in chart.js. Either way the fifth
 *          series must not be the first series drawn twice.
 */
function seriesStyle(index) {
  const repeat = Math.floor(index / SERIES_COLOURS.length);

  return {
    colour: SERIES_COLOURS[index % SERIES_COLOURS.length],
    pointStyle: SERIES_SHAPES[repeat % SERIES_SHAPES.length],
    repeat,
  };
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

export { SEQUENTIAL, SERIES_COLOURS, SERIES_INK, SERIES_SHAPES, seriesStyle };
