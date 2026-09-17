/**
 * Shared asset URLs.
 *
 * Kept in their own module so the splash can preload the printer model without
 * importing the 3D scene — which would pull three.js into the initial bundle
 * and undo the lazy loading of the canvas.
 */

import printerModelUrl from "@/assets/creality-ender-3-pro.glb?url";
import printerMacroUrl from "@/assets/strata-printer-macro.jpg";

export { printerMacroUrl, printerModelUrl };
