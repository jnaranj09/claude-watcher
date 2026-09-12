// Tags — the rail's COMPACT tag mark (spec T-27, §4.2b): a 10px tag-shaped outline stroked in the
// tag's text colour. One tag → one glyph; two → two overlapped; three or more → two + a `+`.
// Colours follow the order given (tag-list order). It draws no text, so it can never read as a
// count pill, and it is a tag shape, never a circle, so it can never read as a StatusDot or a
// WorkspaceDot (T-7).
//
// The overlap cuts the BACK glyph with an SVG mask shaped like the front glyph's outline, instead
// of a stroke painted in the row's colour: a rail row changes fill on hover, when active and when
// it needs you, and a mask is right on every one of them.
//
// Controller ruling (overrides the brief's step-3 code): the 3-or-more `+` is drawn as an SVG PATH
// (two short strokes), not a text glyph or a `<text>` node. As text it needs the 4.5:1 text floor
// and measures only 3.21:1 on the needs-you row (4.48:1 on resting) — both under 4.5. As a graphic
// the non-text 3:1 floor applies instead, which it clears on every row fill, so its contrast is
// covered by the same ≥3:1 stroke test as the tag glyphs (TagIndicator.test.tsx).
//
// `aria-hidden`: the rail's peek <button> around it owns the accessible name ("Tags: prod, …").
import { useId, type JSX } from 'react'
import type { Tag } from '../../../../shared/ipc/contract'
import { TAG_GLYPH_PATH } from './tagGlyph'
import styles from './TagIndicator.module.css'

const SIZE_PX = 10
const UNITS = 16 // viewBox units per glyph
const STROKE = (1.2 * UNITS) / SIZE_PX // a 1.2px line on screen
const OFFSET = 8 // viewBox units the back glyph sits to the right (5px on screen)

// The `+` glyph's own small viewBox — two strokes (one path, two subpaths) forming a plus, at a
// 1:1 unit-to-pixel scale so `PLUS_STROKE` is a true 1.2px line on screen.
const PLUS_SIZE_PX = 8
const PLUS_STROKE = 1.2
const PLUS_GLYPH_PATH = 'M1 4h6M4 1v6'

export interface TagIndicatorProps {
  /** The row's tags, already in tag-list order. Only `color` is drawn. */
  tags: readonly Pick<Tag, 'id' | 'color'>[]
}

export function TagIndicator({ tags }: TagIndicatorProps): JSX.Element | null {
  const maskId = `tag-indicator-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const front = tags[0]
  if (front === undefined) return null
  const back = tags[1]
  const width = back === undefined ? UNITS : UNITS + OFFSET
  return (
    <span
      className={styles.indicator}
      data-testid="tag-indicator"
      data-count={tags.length}
      aria-hidden="true"
    >
      <svg
        className={styles.svg}
        width={(width * SIZE_PX) / UNITS}
        height={SIZE_PX}
        viewBox={`0 0 ${width} ${UNITS}`}
      >
        {back !== undefined && (
          <>
            <defs>
              <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={UNITS}>
                <rect x="0" y="0" width={width} height={UNITS} fill="white" />
                <path
                  d={TAG_GLYPH_PATH}
                  fill="black"
                  stroke="black"
                  strokeWidth={STROKE * 3}
                  strokeLinejoin="round"
                />
              </mask>
            </defs>
            <g mask={`url(#${maskId})`}>
              <Glyph color={back.color} role="back" x={OFFSET} />
            </g>
          </>
        )}
        <Glyph color={front.color} role="front" x={0} />
      </svg>
      {tags.length > 2 && (
        <svg
          className={styles.plus}
          data-testid="tag-indicator-plus"
          width={PLUS_SIZE_PX}
          height={PLUS_SIZE_PX}
          viewBox={`0 0 ${PLUS_SIZE_PX} ${PLUS_SIZE_PX}`}
        >
          <path
            d={PLUS_GLYPH_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth={PLUS_STROKE}
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  )
}

function Glyph(props: { color: Tag['color']; role: 'front' | 'back'; x: number }): JSX.Element {
  const { color, role, x } = props
  return (
    <g
      className={styles[color] ?? ''}
      transform={`translate(${x} 0)`}
      data-testid="tag-glyph"
      data-role={role}
      data-color={color}
    >
      <path
        d={TAG_GLYPH_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <circle cx="5.3" cy="5.3" r="1.1" fill="currentColor" />
    </g>
  )
}
