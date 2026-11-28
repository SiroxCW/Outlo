import { describe, expect, it } from 'vitest';
import {
  darkenAttribute,
  darkenDeclarations,
  darkenSheet,
  NAMED_COLORS,
  parseColor,
} from './darkMail';

const PALETTE = { text: '#ffffff', background: '#292929' };
const channels = (color: string) => parseColor(color)!;
const luminance = (color: { r: number; g: number; b: number }) =>
  [color.r, color.g, color.b]
    .map((channel) => channel / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index]!, 0);
const contrast = (a: Parameters<typeof luminance>[0], b: Parameters<typeof luminance>[0]) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
};

describe('colours of mail in dark mode', () => {
  it('reads the ways CSS writes colours', () => {
    const red = { r: 255, g: 0, b: 0, a: 1 };
    for (const color of [
      '#f00',
      '#ff0000',
      '#FF0000ff',
      'rgb(255, 0, 0)',
      'rgb(100% 0 0)',
      'hsl(0, 100%, 50%)',
      'Red',
    ]) {
      expect(parseColor(color)).toEqual(red);
    }
    expect(parseColor('rgba(0,0,0,.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(0 0 0 / 25%)')).toEqual({ r: 0, g: 0, b: 0, a: 0.25 });
    for (const other of [
      'transparent',
      'windowtext',
      'inherit',
      'currentcolor',
      '#12',
      'rgb(1, 2)',
    ]) {
      expect(parseColor(other)).toBeNull();
    }
    expect(NAMED_COLORS.size).toBe(148);
  });

  it('turns black text and white backgrounds into the colours of the app', () => {
    expect(
      darkenDeclarations('color: #000000; background-color: rgb(255, 255, 255)', PALETTE),
    ).toBe('color: #ffffff; background-color: #292929');
    expect(darkenDeclarations('color:black;background:white', PALETTE)).toBe(
      'color:#ffffff;background:#292929',
    );
  });

  it('keeps what already suits a dark page', () => {
    const banner = 'background:#003366;color:#fff';
    expect(darkenDeclarations(banner, PALETTE)).toBe(banner);
  });

  it('keeps the hue of a colour', () => {
    const before = channels('#0563c1');
    const after = channels(/#\w+/.exec(darkenDeclarations('color: #0563c1', PALETTE))![0]);
    expect(after.b).toBeGreaterThan(after.r);
    expect(after.r + after.g + after.b).toBeGreaterThan(before.r + before.g + before.b);
    // Mid colours that are a little dark for the page get just light enough, keeping their hue.
    const grey = channels(/#\w+/.exec(darkenDeclarations('color: #808080', PALETTE))![0]);
    expect(grey.r).toBe(grey.b);
    expect(contrast(grey, channels('#292929'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(grey, channels('#292929'))).toBeLessThan(4.7);
    const red = channels(/#\w+/.exec(darkenDeclarations('color: #ee4536', PALETTE))![0]);
    expect(red.r).toBeGreaterThan(red.g + 50);
    expect(contrast(red, channels('#292929'))).toBeGreaterThanOrEqual(4.5);
    // A light grey line becomes a dark grey one, not a bright one.
    const line = channels(
      /#\w+/.exec(darkenDeclarations('border: 1px solid #dddddd', PALETTE))![0],
    );
    expect(line.r).toBeLessThan(0x60);
    // Transparency stays.
    expect(darkenDeclarations('background: rgba(255, 255, 255, 0.5)', PALETTE)).toBe(
      'background: rgba(41, 41, 41, 0.5)',
    );
  });

  it('leaves pictures, names, other properties and important marks alone', () => {
    const picture = 'url(data:image/png;base64,AAAA#ffffff)';
    expect(
      darkenDeclarations(
        `background: ${picture} #ffffff no-repeat; color: black !important; font-family: White Rabbit; width: 100px`,
        PALETTE,
      ),
    ).toBe(
      `background: ${picture} #292929 no-repeat; color: #ffffff !important; font-family: White Rabbit; width: 100px`,
    );
    expect(darkenDeclarations('color: windowtext; background: transparent', PALETTE)).toBe(
      'color: windowtext; background: transparent',
    );
  });

  it('changes rules of a style sheet, but not those the mail wrote for dark mode', () => {
    const sheet =
      '<!-- a:hover { color: black } ' +
      '@media (prefers-color-scheme: dark) { .x { color: #111111 } } ' +
      '@media screen { .y { background: white } } ' +
      '/* .c { color: black } */ .z { content: "}"; color: black } -->';
    expect(darkenSheet(sheet, PALETTE)).toBe(
      '<!-- a:hover { color: #ffffff } ' +
        '@media (prefers-color-scheme: dark) { .x { color: #111111 } } ' +
        '@media screen { .y { background: #292929 } } ' +
        '/* .c { color: black } */ .z { content: "}"; color: #ffffff } -->',
    );
  });

  it('changes old colour attributes, also hex codes without #', () => {
    expect(darkenAttribute('#000000', 'text', PALETTE)).toBe('#ffffff');
    expect(darkenAttribute('FFFFFF', 'background', PALETTE)).toBe('#292929');
    expect(darkenAttribute('rgba(255, 255, 255, 0.5)', 'background', PALETTE)).toBe('#292929');
    expect(darkenAttribute('#003366', 'background', PALETTE)).toBe('#003366');
    expect(darkenAttribute('transparent', 'background', PALETTE)).toBe('transparent');
  });
});
