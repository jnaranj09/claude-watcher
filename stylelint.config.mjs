// Stylelint: the values that make the UI look like one app (design.md "UI pipeline", stage 4) come
// from tokens, never raw: spacing, section gaps, borders and dividers, radii, colours, shadows,
// stacking, type and motion. A raw value is a lint error; `var(--…)`, `calc(…)` and the keywords
// below pass. Violations that existed when this landed sit in `stylelint-suppressions.json`
// (`stylelint --suppress` once; the file only shrinks: fix one, run
// `npx stylelint "src/**/*.css" --suppress` to prune it in the same commit).
// The token files themselves, and the bundled themes under `docs/`, are where raw values live.
const KEYWORDS = [
  '/^0(px|%)?$/',
  'auto',
  'none',
  'inherit',
  'initial',
  'unset',
  'transparent',
  'currentColor',
  'currentcolor',
  'normal'
]

export default {
  plugins: ['stylelint-declaration-strict-value'],
  ignoreFiles: ['src/renderer/src/styles/tokens.css', 'src/renderer/src/styles/motion.css'],
  rules: {
    'scale-unlimited/declaration-strict-value': [
      [
        // spacing and section gaps
        '/^(padding|margin)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/',
        '/^(gap|row-gap|column-gap)$/',
        // borders and dividers
        '/^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-(width|color))?$/',
        '/^outline(-(width|color))?$/',
        // radii
        '/^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/',
        // colour and surfaces
        '/^(color|background|background-color|fill|stroke|caret-color|accent-color)$/',
        '/^(box-shadow|text-shadow)$/',
        // stacking, type, motion
        'z-index',
        '/^(font-size|font-weight|line-height|letter-spacing)$/',
        '/^(transition-duration|animation-duration|transition-timing-function)$/'
      ],
      { ignoreValues: KEYWORDS, expandShorthand: true, disableFix: true }
    ]
  }
}
