// Mail in dark mode, as the new Outlook shows it. The colours a mail brings are changed so that
// backgrounds turn dark and text turns light, while their hues stay recognisable. Colours that
// already suit a dark page are kept, and so is what a mail wrote for dark mode itself.

export interface DarkPalette {
  // The colours of the app in dark mode, as #rrggbb.
  text: string;
  background: string;
}

export type ColorRole = 'text' | 'background' | 'line';

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

// The colours CSS knows by name. System colours like windowtext are left to the browser, which
// already shows them in the colours of the page.
const NAMES =
  'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff ' +
  'beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff ' +
  'blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 ' +
  'chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c ' +
  'cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 ' +
  'darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b ' +
  'darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 ' +
  'darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f ' +
  'darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 ' +
  'deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 ' +
  'floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff ' +
  'gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 ' +
  'honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c ' +
  'lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd ' +
  'lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 ' +
  'lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a ' +
  'lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 ' +
  'lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 ' +
  'magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd ' +
  'mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee ' +
  'mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 ' +
  'midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 ' +
  'navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 ' +
  'orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 ' +
  'paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f ' +
  'pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 ' +
  'rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 ' +
  'seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb ' +
  'slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f ' +
  'steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 ' +
  'violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32';
export const NAMED_COLORS: ReadonlyMap<string, string> = new Map(
  NAMES.split(' ').map((entry) => entry.split(':') as [string, string]),
);

const TEXT_PROPERTIES = new Set([
  'color',
  'text-decoration',
  'text-decoration-color',
  'text-emphasis-color',
  'caret-color',
  '-webkit-text-fill-color',
  '-webkit-text-stroke-color',
]);
const BACKGROUND_PROPERTIES = new Set(['background', 'background-color', 'background-image']);
// Prefixes of a rule that holds rules, not declarations.
const GROUP_RULE = /^\s*@(media|supports|document|-moz-document|container|layer|scope)\b/i;
const DARK_MEDIA = /prefers-color-scheme\s*:\s*dark/i;
// What can stand for a colour in a value: a hex code, a colour function or a name. Addresses of
// pictures are matched first, so that nothing in them is taken for a colour.
const VALUE_TOKEN =
  /url\((?:[^)"']|"[^"]*"|'[^']*')*\)|#[0-9a-f]+\b|\b(?:rgba?|hsla?)\([^)]*\)|(?<![-\w])[a-z]+(?![-\w(])/gi;

function parseHex(digits: string): Color | null {
  if (![3, 4, 6, 8].includes(digits.length) || !/^[0-9a-f]+$/i.test(digits)) return null;
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const channel = (index: number) => parseInt(full.slice(index * 2, index * 2 + 2), 16);
  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    a: full.length === 8 ? channel(3) / 255 : 1,
  };
}

function hueToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

export function parseColor(token: string): Color | null {
  const text = token.trim().toLowerCase();
  if (text.startsWith('#')) return parseHex(text.slice(1));
  const named = NAMED_COLORS.get(text);
  if (named) return parseHex(named);
  const call = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(text);
  if (!call) return null;
  const parts = call[2]!.split(/[\s,/]+/).filter((part) => part !== '');
  if (parts.length < 3 || parts.length > 4) return null;
  const number = (part: string, scale: number) =>
    part.endsWith('%') ? (parseFloat(part) / 100) * scale : parseFloat(part);
  const a = parts[3] === undefined ? 1 : number(parts[3], 1);
  let rgb: number[];
  if (call[1]!.startsWith('rgb')) {
    rgb = parts.slice(0, 3).map((part) => number(part, 255));
  } else {
    const hue = parts[0]!;
    const h =
      parseFloat(hue) * (hue.endsWith('turn') ? 360 : hue.endsWith('rad') ? 180 / Math.PI : 1);
    rgb = hueToRgb(((h % 360) + 360) % 360, number(parts[1]!, 1), number(parts[2]!, 1));
  }
  if ([...rgb, a].some((value) => Number.isNaN(value))) return null;
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  return { r: clamp(rgb[0]!, 255), g: clamp(rgb[1]!, 255), b: clamp(rgb[2]!, 255), a: clamp(a, 1) };
}

function formatColor({ r, g, b, a }: Color, withAlpha: boolean): string {
  const channels = [r, g, b].map((channel) => Math.round(channel));
  if (withAlpha && a < 1) return `rgba(${channels.join(', ')}, ${Math.round(a * 1000) / 1000})`;
  return '#' + channels.map((channel) => channel.toString(16).padStart(2, '0')).join('');
}

// Oklab: a colour space where lightness can be changed without the hue drifting.
const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) =>
  255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055);

function toOklab({ r, g, b }: Color): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function linearFromOklab(lightness: number, a: number, b: number): [number, number, number] {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// Relative luminance, as contrast between text and background is measured.
const luminance = ({ r, g, b }: Color) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const BLACK: Color = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Color = { r: 255, g: 255, b: 255, a: 1 };
// Text on the page has at least this contrast to it, as asked for ordinary text.
const TEXT_CONTRAST = 4.5;

// The colour at a lightness, with the hue of a, b. Strong colours may not exist at every
// lightness: they lose as little saturation as needed.
function atLightness(lightness: number, a: number, b: number, alpha: number): Color {
  const fits = (scale: number) =>
    linearFromOklab(lightness, a * scale, b * scale).every((c) => c >= -0.0001 && c <= 1.0001);
  let scale = 1;
  if (!fits(1)) {
    let low = 0;
    let high = 1;
    for (let step = 0; step < 16; step++) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle;
      else high = middle;
    }
    scale = low;
  }
  const [r, g, bl] = linearFromOklab(lightness, a * scale, b * scale).map(fromLinear);
  // Rounded as it will be written, so that a contrast found here is the one shown.
  const clamp = (value: number) => Math.round(Math.min(255, Math.max(0, value)));
  return { r: clamp(r!), g: clamp(g!), b: clamp(bl!), a: alpha };
}

// The new colour for a colour of a mail, or null to keep it. Lightness is turned around, so that
// white becomes the background of the app and black its text. Text only ever gets lighter and
// backgrounds only darker, so a dark banner with white letters stays as it is. Text also gets
// light enough to read on the page, keeping its hue.
function changeColor(color: Color, role: ColorRole, palette: DarkPalette): Color | null {
  if (color.a === 0) return null;
  const page = parseColor(palette.background) ?? BLACK;
  const [dark] = toOklab(page);
  const [light] = toOklab(parseColor(palette.text) ?? WHITE);
  const [lightness, a, b] = toOklab(color);
  const turned = dark + (1 - lightness) * (light - dark);
  const target =
    role === 'text'
      ? Math.max(lightness, turned)
      : role === 'background'
        ? Math.min(lightness, turned)
        : turned;
  let result = Math.abs(target - lightness) < 0.002 ? color : atLightness(target, a, b, color.a);
  const readable = TEXT_CONTRAST * (luminance(page) + 0.05) - 0.05;
  if (role === 'text' && luminance(result) < readable) {
    let low = target;
    let high = 1;
    for (let step = 0; step < 16; step++) {
      const middle = (low + high) / 2;
      if (luminance(atLightness(middle, a, b, color.a)) >= readable) high = middle;
      else low = middle;
    }
    result = atLightness(high, a, b, color.a);
  }
  return result === color ? null : result;
}

function roleOf(property: string): ColorRole | null {
  const name = property.toLowerCase();
  if (TEXT_PROPERTIES.has(name)) return 'text';
  if (BACKGROUND_PROPERTIES.has(name)) return 'background';
  if (/^(border|outline|column-rule)/.test(name)) return 'line';
  return null;
}

function darkenValue(value: string, role: ColorRole, palette: DarkPalette): string {
  return value.replace(VALUE_TOKEN, (token) => {
    if (/^url\(/i.test(token)) return token;
    const color = parseColor(token);
    const changed = color && changeColor(color, role, palette);
    return changed ? formatColor(changed, true) : token;
  });
}

// Moves past a string or a comment that starts at the index, so nothing in it counts.
function skipQuoted(text: string, index: number): number {
  const char = text[index];
  if (char === '/' && text[index + 1] === '*') {
    const end = text.indexOf('*/', index + 2);
    return end === -1 ? text.length : end + 2;
  }
  if (char === '"' || char === "'") {
    let at = index + 1;
    while (at < text.length && text[at] !== char) at += text[at] === '\\' ? 2 : 1;
    return at + 1;
  }
  return index;
}

// Splits at the semicolons that end declarations, not those in a string, comment or bracket,
// like the one in a picture written into the mail as data:image/png;base64.
function splitDeclarations(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const skipped = skipQuoted(text, index);
    if (skipped !== index) {
      index = skipped - 1;
      continue;
    }
    const char = text[index];
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ';' && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// The declarations of a style attribute, or of one rule of a style sheet.
export function darkenDeclarations(text: string, palette: DarkPalette): string {
  return splitDeclarations(text)
    .map((part) => {
      const declaration = /^(\s*)([-\w]+)(\s*:)([\s\S]*)$/.exec(part);
      const role = declaration && roleOf(declaration[2]!);
      if (!role) return part;
      const [, space, property, colon, value] = declaration;
      return space! + property! + colon! + darkenValue(value!, role, palette);
    })
    .join(';');
}

// The index of the brace that closes the block opening before the index.
function closingBrace(text: string, index: number): number {
  let depth = 1;
  for (let at = index; at < text.length; at++) {
    const skipped = skipQuoted(text, at);
    if (skipped !== at) {
      at = skipped - 1;
      continue;
    }
    if (text[at] === '{') depth++;
    if (text[at] === '}' && --depth === 0) return at;
  }
  return text.length;
}

// A whole style sheet. Rules for dark mode that the mail brings are left as they are.
export function darkenSheet(text: string, palette: DarkPalette): string {
  let result = '';
  let copied = 0;
  let prelude = 0;
  // For each group rule around the current place, whether it is one for dark mode.
  const groups: boolean[] = [];
  let index = 0;
  while (index < text.length) {
    const skipped = skipQuoted(text, index);
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    const char = text[index];
    const inDarkGroup = groups.includes(true);
    if (char === '{') {
      const head = text.slice(prelude, index);
      if (GROUP_RULE.test(head)) {
        groups.push(DARK_MEDIA.test(head));
        index++;
        prelude = index;
        continue;
      }
      const end = closingBrace(text, index + 1);
      const block = text.slice(index + 1, end);
      result +=
        text.slice(copied, index + 1) + (inDarkGroup ? block : darkenDeclarations(block, palette));
      copied = end;
      index = end + 1;
      prelude = index;
      continue;
    }
    if (char === '}') groups.pop();
    if (char === '}' || char === ';') prelude = index + 1;
    index++;
  }
  return result + text.slice(copied);
}

// A colour attribute of old HTML, like bgcolor. Old HTML also takes hex codes without the #.
export function darkenAttribute(value: string, role: ColorRole, palette: DarkPalette): string {
  const text = value.trim();
  const color =
    parseColor(text) ?? (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text) ? parseHex(text) : null);
  const changed = color && changeColor(color, role, palette);
  return changed ? formatColor(changed, false) : value;
}
