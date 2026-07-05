import { random } from "remotion";
import { loadFont as libreBaskerville } from "@remotion/google-fonts/LibreBaskerville";
import { loadFont as ptSerif } from "@remotion/google-fonts/PTSerif";
import { loadFont as lora } from "@remotion/google-fonts/Lora";
import { loadFont as sourceSerif4 } from "@remotion/google-fonts/SourceSerif4";
import { loadFont as domine } from "@remotion/google-fonts/Domine";
import { loadFont as spectral } from "@remotion/google-fonts/Spectral";
import { loadFont as gelasio } from "@remotion/google-fonts/Gelasio";
import { loadFont as tinos } from "@remotion/google-fonts/Tinos";
import { loadFont as frankRuhlLibre } from "@remotion/google-fonts/FrankRuhlLibre";
import { loadFont as notoSerif } from "@remotion/google-fonts/NotoSerif";
import { loadFont as cardo } from "@remotion/google-fonts/Cardo";
import { loadFont as crimsonText } from "@remotion/google-fonts/CrimsonText";
import { loadFont as vollkorn } from "@remotion/google-fonts/Vollkorn";
import { loadFont as oldStandardTT } from "@remotion/google-fonts/OldStandardTT";
import { loadFont as enriqueta } from "@remotion/google-fonts/Enriqueta";

// Only the regular latin weight is needed — keeps font network requests low at render time.
const opts = () => ({ weights: ["400" as const], subsets: ["latin" as const] });

// Transitional-serif pool the answer cycles through — one is picked per detail
// switch so the answer re-letters each time the progress advances.
export const ANSWER_FONTS: string[] = [
  libreBaskerville("normal", opts()).fontFamily,
  ptSerif("normal", opts()).fontFamily,
  lora("normal", opts()).fontFamily,
  sourceSerif4("normal", opts()).fontFamily,
  domine("normal", opts()).fontFamily,
  spectral("normal", opts()).fontFamily,
  gelasio("normal", opts()).fontFamily,
  tinos("normal", opts()).fontFamily,
  frankRuhlLibre("normal", opts()).fontFamily,
  notoSerif("normal", opts()).fontFamily,
  cardo("normal", opts()).fontFamily,
  crimsonText("normal", opts()).fontFamily,
  vollkorn("normal", opts()).fontFamily,
  oldStandardTT("normal", opts()).fontFamily,
  enriqueta("normal", opts()).fontFamily,
];

// Pick a font for the given switch counter (number of details revealed so far).
// Deterministic per counter and biased to avoid repeating the previous pick.
export function answerFontFor(switchCount: number): string {
  const idx = Math.floor(random(`answer-font-${switchCount}`) * ANSWER_FONTS.length);
  return ANSWER_FONTS[idx];
}
