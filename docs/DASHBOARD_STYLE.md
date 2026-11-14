# Dashboard Front-End Style Spec — Turquoise

A complete, implementation-ready description of the Dashboard screen's look and motion, in the **turquoise** accent. It is written so another project can reproduce the same style exactly: every token, size, easing and rule here is copied from the shipping stylesheet, not approximated.

> **Out of scope: the background.** The animated light streak, dot grid and vignette behind the app are specified in a separate document. Everything here assumes it sits over a near-black page (`--bg: #050909`). Where a value only makes sense because something lies behind the glass, the spec says so.

---

## Contents

1. [Design principles](#1-design-principles)
2. [Design tokens (paste-ready)](#2-design-tokens-paste-ready)
3. [Typography](#3-typography)
4. [Spacing, radii and grid](#4-spacing-radii-and-grid)
5. [The surface: glass cards with corner brackets](#5-the-surface-glass-cards-with-corner-brackets)
6. [Card anatomy](#6-card-anatomy)
7. [Small components](#7-small-components)
8. [Data display](#8-data-display)
9. [Dashboard layout](#9-dashboard-layout)
10. [The deck's cards, one by one](#10-the-decks-cards-one-by-one)
11. [The case-structure flow panel](#11-the-case-structure-flow-panel)
12. [The clerk (chat) card](#12-the-clerk-chat-card)
13. [Top chrome: status readout and island menus](#13-top-chrome-status-readout-and-island-menus)
14. [The menu wheel](#14-the-menu-wheel)
15. [Motion system](#15-motion-system)
16. [Responsive and touch](#16-responsive-and-touch)
17. [Accessibility and reduced motion](#17-accessibility-and-reduced-motion)
18. [Performance rules (learned the hard way)](#18-performance-rules-learned-the-hard-way)
19. [Do / don't](#19-do--dont)
20. [Starter markup](#20-starter-markup)

---

## 1. Design principles

- **Dark, quiet, instrument-panel.** A near-black room with smoked-glass panels standing in it. It's precise and minimal. Nothing is decorative unless it says something.
- **The accent is rare.** Turquoise `#3EE0D0` marks only what is live, selected or actionable: an active pill, a lit status dot, the selected deck dot, a hovered wire, the typing caret, the clerk's name. Data ink (charts, bars) stays **neutral off-white**, never turquoise.
- **Three status colours, used for status only.** Amber means *due soon*, red means *overdue*, accent means *done or live*. Nothing else may use them.
- **Edges are corners, not outlines.** Cards have no visible border. Their edge is four short white corner brackets, and the glass, blur and shadow do the rest.
- **One emphasised word.** The italic serif is a change of register for one word at a time (e.g. "Good *evening*."). It is never used for a highlight or for a whole line.
- **Labels are data.** Section labels, timestamps, counts and readouts are set in lowercase monospace, in faint ink. Headings are sans and medium weight.
- **Screens are built, not faded.** On arrival, elements rise into place in reading order on an expo-out curve. There's no bounce on content. Springs are only for "island" controls.
- **No perpetual motion.** Anything that loops forever is stepped or stopped. A smooth infinite animation re-blurs every glass panel on every frame (see §18).

---

## 2. Design tokens (paste-ready)

Drop this block in as-is. The accent is switched with `data-accent="turquoise"` on `<html>`. The `:root` block holds everything derived from it, so a new accent only needs the per-accent block.

```css
/* ---- the turquoise accent ------------------------------------------- */
[data-accent='turquoise'] {
  --accent:        #3EE0D0;   /* the one colour */
  --accent-hover:  #6BE9DC;   /* hover on a solid accent surface */
  --accent-ink:    #031412;   /* text ON a solid accent fill */
  --accent-rgb:    62, 224, 208;
  --accent-cool:   #4AA8FF;   /* secondary cool tone (rare) */

  --bg:            #050909;   /* the page */
  --text:          #EEF4F4;
  --text-rgb:      238, 244, 244;

  /* surface tints, as rgb triplets so alpha can be chosen per use */
  --panel-rgb:     10, 17, 16;   /* card glass */
  --overlay-rgb:   11, 17, 17;   /* popovers, tips, chips over glass */
  --raised-rgb:    19, 26, 25;   /* flow step cards */
  --raised-hi-rgb: 23, 33, 32;   /* the root step card */
  --solid-rgb:     19, 29, 28;   /* lifted (3D) step cards */
  --solid-hi-rgb:  25, 38, 37;
}

/* ---- derived from the accent: identical for every accent ------------ */
:root {
  --bg-elevated:   rgba(255, 255, 255, 0.03);   /* chips, tool buttons, hover wells */
  --panel:         rgba(var(--panel-rgb), 0.46);
  --panel-blur:    blur(30px) saturate(1.25);
  --overlay:       rgba(var(--overlay-rgb), 0.95);

  --border:        rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);
  --line-soft:     rgba(255, 255, 255, 0.05);   /* dividers inside a card */

  --text-muted:    rgba(var(--text-rgb), 0.55);
  --text-faint:    rgba(var(--text-rgb), 0.32);

  --accent-glow:   rgba(var(--accent-rgb), 0.35);  /* soft glows, box-shadow halos */
  --accent-faint:  rgba(var(--accent-rgb), 0.10);  /* hover tint behind an option */
  --accent-wash:   rgba(var(--accent-rgb), 0.18);  /* selected fill you can see through */
  --accent-edge:   rgba(var(--accent-rgb), 0.45);  /* focus rings, hovered edges */

  /* status — these three and nothing else */
  --amber:         #E3B341;   /* due soon */
  --red:           #E5704F;   /* overdue: muted, not a siren */
  --hot-soft:      rgba(229, 112, 79, 0.14);

  /* data ink: neutral, never the accent */
  --bar:           rgba(242, 244, 239, 0.78);
  --bar-dim:       rgba(255, 255, 255, 0.07);

  /* aliases used throughout the component CSS below */
  --fg:            var(--text);
  --fg-mid:        var(--text-muted);
  --fg-dim:        var(--text-faint);
  --line:          var(--border);
  --card-hi:       var(--bg-elevated);
  --hot:           var(--red);
  --sage:          var(--accent);          /* "highlighted surface" = solid accent */
  --on-sage:       var(--accent-ink);
  --on-sage-dim:   rgba(11, 13, 6, 0.62);

  /* shape */
  --radius:        3px;     /* cards: nearly square */
  --radius-sm:     10px;    /* rows, tiles, step cards, tips */
  --radius-xs:     8px;     /* small tool buttons */
  --radius-pill:   999px;

  /* type */
  --font:       'Geist Variable', 'Geist', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono:  'Geist Mono', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --font-serif: 'Instrument Serif', 'Times New Roman', serif;

  /* rhythm */
  --pad:     22px;   /* card inner padding */
  --gap:     14px;   /* grid gap */
  --shell-x: 30px;   /* page side margin */
}

@media (max-width: 760px) {
  :root { --shell-x: 14px; --pad: 16px; }
}
```

### Colour roles at a glance

| Role | Token | Value (turquoise) |
|---|---|---|
| Page | `--bg` | `#050909` |
| Primary text | `--text` | `#EEF4F4` |
| Secondary text | `--text-muted` | text @ 55% |
| Labels, timestamps | `--text-faint` | text @ 32% |
| Card glass | `--panel` | `rgb(10 17 16 / .46)` + `blur(30px) saturate(1.25)` |
| Dashboard card glass | — | `rgb(10 17 16 / .72)` (denser, see §9) |
| Hairline | `--border` | white @ 8% |
| Strong hairline | `--border-strong` | white @ 14% |
| Divider in a card | `--line-soft` | white @ 5% |
| Accent | `--accent` | `#3EE0D0` |
| Text on accent | `--accent-ink` | `#031412` |
| Glow | `--accent-glow` | accent @ 35% |
| Focus / hovered edge | `--accent-edge` | accent @ 45% |
| Due soon | `--amber` | `#E3B341` |
| Overdue | `--red` | `#E5704F` |
| Chart ink | `--bar` / `--bar-dim` | off-white @ 78% / white @ 7% |
| Card corner brackets | — | white @ 42%, 2px |

---

## 3. Typography

Three faces, each with a single job.

| Face | Job | Load |
|---|---|---|
| **Geist** (variable) | All UI text, headings, numbers | `@fontsource-variable/geist` |
| **Geist Mono** 400/500 | Labels, timestamps, counts, readouts, status text | `@fontsource/geist-mono` |
| **Instrument Serif** 400 + italic | One emphasised word at a time | `@fontsource/instrument-serif` |

### Base

```css
body {
  font-family: var(--font);
  font-size: 13.5px;
  font-weight: 450;               /* variable weight: between regular and medium */
  line-height: 1.5;
  letter-spacing: -0.005em;
  color: var(--text);
  background: var(--bg);
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1, h2, h3 { font-weight: 500; letter-spacing: -0.02em; }

/* the one emphasised word */
.serif {
  font-family: var(--font-serif);
  font-style: italic;
  font-weight: 400;
  font-size: 1.14em;     /* the serif's x-height is smaller; this levels it */
  letter-spacing: 0;
}

/* inline data */
.mono, .micro {
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 400;
  line-height: 1.45;
  letter-spacing: 0.01em;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
```

### Type scale used on the Dashboard

| Element | Face | Size / weight | Tracking | Line-height | Colour |
|---|---|---|---|---|---|
| Greeting (`.dash__greet`) | Geist | `clamp(34px, 4vw, 52px)` / 500 | -0.03em | 1.02 | text |
| Greeting's serif word | Instrument Serif italic | 1.05em of greeting | 0 | — | text |
| Headline under greeting | Geist | 14px / 450 | — | 1.55 | muted, max 34ch |
| Brief paragraph | Geist | 15px / 450 | — | 1.6 | muted, max 46ch |
| Card title | Geist | 16px / 500 | -0.015em | 1.25 | text |
| Card subtitle | Geist | 12px / 400 | — | 1.35 | muted |
| Flow panel title | Geist | 14px / 500 | -0.015em | — | text |
| Big metric | Geist | 40px / 400 (34 small, 48 large) | -0.03em | 1.02 | text |
| Body in cards | Geist | 12–13px | — | 1.5–1.62 | text / muted |
| Pill text | Geist | 12.5px / 500 | — | 1.25 | text |
| Section label | Geist Mono | 11px | 0.08em, lowercase | — | faint |
| "up next" header | Geist Mono | 10.5px | 0.14em, lowercase | — | faint |
| Run-log rows | Geist Mono | 11.5px | — | — | faint / text |
| Kickers ("ON THE WIRE", "CLERK") | Geist Mono | 9.5px | 0.1em, UPPERCASE | — | faint, 80% |
| Status pill | Geist Mono | 11px | 0.01em, lowercase | — | muted / text |

**Rules**
- Headings never go above weight 500. Weight, not size, separates levels.
- Negative tracking grows with size: -0.005em body, -0.015em titles, -0.03em display.
- Monospace labels are **lowercase** for readouts and **UPPERCASE** only for tiny kickers (≤10px) with 0.08–0.16em tracking.
- Numbers are always tabular.
- On phones nothing goes below 11px. The 9.5–10.5px mono labels are raised to 11px.

---

## 4. Spacing, radii and grid

- **Card padding** `--pad`: 22px (16px ≤760px).
- **Grid gap** `--gap`: 14px.
- **Page margin** `--shell-x`: 30px (14px ≤760px). The content column is capped at **1560px** and centred.
- **Inner rhythm:** 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 22 / 28px. Card body gap 16px, after a card head 18px top padding, head-to-actions gap 12px.

| Radius | Value | Used for |
|---|---|---|
| `--radius` | **3px** | cards. Nearly square, the signature shape |
| `--radius-sm` | 10px | list rows, tiles, tips, flow step cards, week cells |
| `--radius-xs` | 8px | 26px tool buttons |
| `--radius-pill` | 999px | pills, status pills, chips, meters |

**Bento grid** (used on other screens; the Dashboard uses its own two-column layout, see §9):

```css
.bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--gap); }
/* .span-1 … .span-12 → grid-column: span N */
@media (max-width: 1180px) { .bento { grid-template-columns: repeat(6, 1fr); } /* spans become 6 */ }
@media (max-width: 760px)  { .bento { grid-template-columns: 1fr; } }
```

---

## 5. The surface: glass cards with corner brackets

The card is the whole visual identity. It has three ingredients: **smoked glass** (a translucent dark fill plus a strong backdrop blur), **a deep soft shadow**, and **four white corner brackets** instead of a border.

```css
.card {
  --corner: 14px;                         /* bracket arm length */
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--panel);               /* rgb(10 17 16 / .46) */
  -webkit-backdrop-filter: var(--panel-blur);
  backdrop-filter: var(--panel-blur);     /* blur(30px) saturate(1.25) */
  border: 1px solid transparent;          /* keeps the box size; no visible outline */
  border-radius: var(--radius);           /* 3px */
  overflow: hidden;
  color: var(--fg);
  box-shadow: 0 22px 60px -30px rgba(0, 0, 0, 0.92);
}

/* THE CORNERS: one layer the size of the card, with a 2px white border,
   masked down to a 14px square at each corner. Because the layer inherits
   the card's radius, each bracket follows the card's own (tiny) curve. */
.card:not(.card--flat)::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  border: 2px solid rgba(255, 255, 255, 0.42);
  border-radius: inherit;
  pointer-events: none;
  -webkit-mask:
    linear-gradient(#000 0 0) left  top    / var(--corner) var(--corner) no-repeat,
    linear-gradient(#000 0 0) right top    / var(--corner) var(--corner) no-repeat,
    linear-gradient(#000 0 0) left  bottom / var(--corner) var(--corner) no-repeat,
    linear-gradient(#000 0 0) right bottom / var(--corner) var(--corner) no-repeat;
          mask:
    linear-gradient(#000 0 0) left  top    / var(--corner) var(--corner) no-repeat,
    linear-gradient(#000 0 0) right top    / var(--corner) var(--corner) no-repeat,
    linear-gradient(#000 0 0) left  bottom / var(--corner) var(--corner) no-repeat,
    linear-gradient(#000 0 0) right bottom / var(--corner) var(--corner) no-repeat;
}

/* A flat card: no glass, no corners. For grouping without a surface. */
.card--flat { background: transparent; border-color: transparent; }
.card--pad  { padding: var(--pad); }
```

**On the Dashboard the glass is denser** because the light behind is brightest on this screen:

```css
.dash__card { background: rgba(var(--panel-rgb), 0.72); }
```

**Optional "bare" mode.** This is a user setting that strips the glass and keeps only the contents and corners. On phones the Dashboard is always bare:

```css
[data-cards='bare'] .card:not(.card--flat) {
  background: transparent;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: none;
}
@media (max-width: 640px) {
  .card.dash__card { background: transparent; backdrop-filter: none; box-shadow: none; }
}
```

**Why it reads as glass:** the fill is translucent, so the background shows through. The blur turns what shows through into a wash rather than a picture. The shadow is offset far down (22px), spread wide (60px) and pulled in (-30px), so it reads as depth rather than as a drop shadow.

---

## 6. Card anatomy

```
┌─                                                    ─┐  ← corner brackets only
   Title (16/500)                         [pill] [⋯]      .card__head
   Subtitle (12, muted)                                    padding: 22 22 0
                                                           .card__body
   … content …                                             padding: 18 22 22, gap 16

   ─────────────────────────────────────────────────       .card__foot (border-top)
   Label (11, muted)                          value         padding: 14 22
└─                                                    ─┘
```

```css
.card__head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: var(--pad) var(--pad) 0;
  min-width: 0;
}
.card__headtext { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.card__title { font-size: 16px; font-weight: 500; letter-spacing: -0.015em; line-height: 1.25; color: var(--fg); overflow-wrap: anywhere; }
.card__sub   { font-size: 12px; font-weight: 400; line-height: 1.35; color: var(--fg-mid); overflow-wrap: anywhere; }
.card__right { flex: none; display: inline-flex; align-items: center; gap: 8px; margin-top: -2px; }

.card__body {
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--pad);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card__head + .card__body { padding-top: 18px; }
.card__body--tight  { gap: 10px; }
.card__body--flush  { padding: 0; }
.card__body--center { justify-content: center; }

.card__foot {
  flex: none;
  min-width: 0;
  padding: 14px var(--pad);
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--fg-mid);
}
.card__divider { height: 1px; background: var(--line); margin: 0 calc(var(--pad) * -1); }

/* a tile: a small well inside a card */
.tile {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
}
```

---

## 7. Small components

### Pill (button)

```css
.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 6px 14px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.25;
  color: var(--text);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  white-space: nowrap;
  max-width: 100%;
  cursor: pointer;
  transition:
    background-color 220ms cubic-bezier(0.22, 1, 0.3, 1),
    border-color     220ms cubic-bezier(0.22, 1, 0.3, 1),
    color            220ms cubic-bezier(0.22, 1, 0.3, 1),
    box-shadow       220ms cubic-bezier(0.22, 1, 0.3, 1),
    transform        220ms cubic-bezier(0.22, 1, 0.3, 1);
}
.pill:hover:not(:disabled)  { background: rgba(255, 255, 255, 0.06); border-color: var(--border-strong); }
.pill:active:not(:disabled) { transform: translateY(1px); }

/* active / primary: the solid accent chip. One rule, many ways to say it. */
.pill--active, .pill.is-active, .pill[aria-pressed='true'], .pill[aria-expanded='true'] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
  box-shadow: 0 0 20px -4px var(--accent-glow);
}
.pill--active:hover:not(:disabled),
.pill.is-active:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); color: var(--accent-ink); }

.pill--ghost  { border-color: transparent; color: var(--fg-mid); }
.pill--ghost:hover:not(:disabled) { color: var(--fg); }
.pill--micro  { padding: 3px 9px; font-size: 11px; }
.pill--danger { color: var(--hot); border-color: var(--line); }
.pill--danger:hover:not(:disabled) { background: var(--hot-soft); border-color: var(--hot); }
.pill:disabled { opacity: 0.4; pointer-events: none; }
```

### Status pill (a readout, never a button)

A lit dot and one lowercase mono phrase: "● all systems normal". It never takes the pointer.

```css
.statpill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 11px 4px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--bg-elevated);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.01em;
  color: var(--text-muted);
  white-space: nowrap;
}
.statpill::before {
  content: '';
  width: 6px; height: 6px; flex: none;
  border-radius: 50%;
  background: var(--tone, var(--text-faint));
  box-shadow: 0 0 8px 0 var(--tone-glow, transparent);
  animation: statpulse 2s steps(6, jump-none) infinite;
}
.statpill--ok      { --tone: var(--accent); --tone-glow: var(--accent-glow);      color: var(--text); }
.statpill--soon    { --tone: var(--amber);  --tone-glow: rgba(227,179,65,.4);     color: var(--text); }
.statpill--overdue { --tone: var(--red);    --tone-glow: rgba(229,112,79,.4);     color: var(--text); }
.statpill--idle    { --tone: var(--border-strong); }
.statpill--idle::before { animation: none; }

/* STEPPED breath, six levels each way. A smooth infinite fade repaints
   every frame and re-blurs every glass panel; stepped, the GPU idles. */
@keyframes statpulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}
```

### Status dot

```css
.status-dot          { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--text-faint); }
.status-dot--live    { background: var(--accent); box-shadow: 0 0 8px 0 var(--accent-glow);       animation: statpulse 2s steps(6, jump-none) infinite; }
.status-dot--overdue { background: var(--red);    box-shadow: 0 0 8px 0 rgba(229,112,79,.4);      animation: statpulse 2s steps(6, jump-none) infinite; }
.status-dot--idle    { background: var(--border-strong); }
```

### Icon menu button (⋯)

```css
.iconmenu {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 3px; width: 24px; height: 24px; flex: none;
  border-radius: var(--radius-pill);
  color: var(--fg-mid);
  transition: background-color 140ms ease, color 140ms ease;
}
.iconmenu:hover, .iconmenu[aria-expanded='true'] { background: var(--card-hi); color: var(--fg); }
.iconmenu__dot { width: 3px; height: 3px; border-radius: 50%; background: currentColor; }
```

### Section label

```css
.section-label {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: lowercase;
  color: var(--text-faint);
  white-space: nowrap;
}
```

### Link

```css
.link       { color: var(--fg-mid); border-bottom: 1px solid var(--line); transition: color 140ms ease, border-color 140ms ease; }
.link:hover { color: var(--fg); border-bottom-color: var(--fg-mid); }
```

### Empty state

The one place with a voice. The last word of the lead is set in the italic serif.

```css
.empty       { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 6px; padding: 22px 0; min-height: 92px; }
.empty__lead { font-size: 17px; font-weight: 450; letter-spacing: -0.015em; line-height: 1.35; color: var(--text); }
.empty__hint { font-size: 11px; color: var(--fg-dim); }
```

Example: `Nothing <em class="serif">urgent.</em>` / `No entry needs attention today.`

---

## 8. Data display

**Chart rule:** data ink is neutral (`--bar`, off-white at 78%). The empty track is `--bar-dim`. The accent is never spent on bars. Only a single live or selected value may be picked out (solid accent cell, overdue in red).

### Metric

```css
.metric        { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.metric__value { display: flex; align-items: baseline; gap: 0.3em;
                 font-size: 40px; font-weight: 400; letter-spacing: -0.03em; line-height: 1.02;
                 color: var(--fg); white-space: nowrap; }
.metric--sm .metric__value { font-size: 34px; }
.metric--lg .metric__value { font-size: 48px; }
.metric__unit  { flex: none; font-size: 11px; font-weight: 400; color: var(--fg-mid); line-height: 1.35; }
.metric__sub   { font-size: 11px; color: var(--fg-dim); line-height: 1.35; }
.metric--hot .metric__value { color: var(--hot); }
```

The big number is weight **400**, not bold. Its size carries it.

### Trend arrow

```css
.trend       { display: inline-flex; align-items: center; justify-content: center; flex: none; font-size: 11px; line-height: 1; color: var(--fg-mid); }
.trend svg   { width: 12px; height: 12px; }
.trend--up   { color: var(--fg); }
.trend--down { color: var(--fg-dim); }
```

### Meter (hairline progress)

A **1px** track (3px with `--thick`). Neutral fill, never accent.

```css
.meter        { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; }
.meter__track { position: relative; flex: 1 1 auto; height: 1px; min-width: 24px;
                background: var(--bar-dim); border-radius: var(--radius-pill); overflow: hidden; }
.meter__fill  { position: absolute; inset: 0 auto 0 0; height: 100%;
                background: var(--bar); border-radius: var(--radius-pill); transition: width 320ms ease; }
.meter__value { flex: none; font-size: 11px; color: var(--fg); text-align: right; min-width: 34px; }
.meter__label { flex: none; font-size: 11px; color: var(--fg-mid); }
.meter--thick .meter__track { height: 3px; }
```

### Mini bars (sparkline bar chart)

An SVG of thin vertical bars, 92px tall, all sharing the chart's bottom edge.

```css
.minibars       { display: block; width: 100%; height: auto; overflow: visible; color: var(--bar); }
.minibars__bar  { fill: var(--bar); shape-rendering: crispEdges; }
.minibars__bar--dim { fill: var(--bar-dim); }
```

### Week table (7 day cells and a rail)

The current day is the one **solid accent** cell, with dark accent-ink text.

```css
.weektable        { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.weektable__row   { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.weektable__cell  { display: flex; flex-direction: column; justify-content: space-between; gap: 12px;
                    padding: 10px 8px; border-radius: var(--radius-sm); background: transparent; color: var(--fg-mid);
                    transition: background-color 160ms ease, color 160ms ease; }
.weektable__cell.is-active { background: var(--accent); color: var(--accent-ink); }
.weektable__day   { display: flex; align-items: center; gap: 5px; font-size: 11px; line-height: 1; color: var(--fg-mid); }
.weektable__cell.is-active .weektable__day   { color: var(--on-sage-dim); }
.weektable__value { font-size: 11px; line-height: 1; color: var(--fg-mid); }
.weektable__cell.is-active .weektable__value { color: var(--accent-ink); }
.weektable__rail  { display: grid; grid-template-columns: repeat(7, 1fr); height: 6px;
                    border-radius: var(--radius-pill); overflow: hidden; background: var(--bar-dim); }
.weektable__seg.is-active { background: var(--accent); }
```

### Timeline dots

Thirteen-pixel rings on a 1px line. Filled dots are **white**, not accent.

```css
.timelinedots__track         { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 4px; min-height: 13px; }
.timelinedots__track::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: var(--line); transform: translateY(-50%); }
.timelinedots__dot           { position: relative; width: 13px; height: 13px; border-radius: 50%; background: var(--bg); border: 1px solid var(--line); }
.timelinedots__dot.is-filled { background: var(--fg); border-color: var(--fg); }
.timelinedots__labels        { display: flex; justify-content: space-between; gap: 4px; font-size: 11px; color: var(--fg-mid); }
.timelinedots__label.is-active { color: var(--fg); }
```

### Sub-panels (three columns with hairline dividers)

```css
.subpanels    { display: grid; gap: 0; }
.subpanels--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.subpanel     { min-width: 0; padding: 0 18px; display: flex; flex-direction: column; gap: 14px; }
.subpanels--3 > .subpanel + .subpanel { border-left: 1px solid var(--line); }
.subpanel:first-child { padding-left: 0; }
.subpanel:last-child  { padding-right: 0; }
.subpanel__head  { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.subpanel__label { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--fg-mid); white-space: nowrap; }
```

### Tip (recommendation)

```css
.tiplist   { display: flex; flex-direction: column; gap: 10px; }
.tip       { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 14px;
             background: var(--overlay);
             -webkit-backdrop-filter: var(--panel-blur); backdrop-filter: var(--panel-blur);
             border: 1px solid var(--line-soft); border-radius: var(--radius-sm); color: var(--fg); }
.tip__body { font-size: 12px; line-height: 1.5; color: var(--fg); overflow-wrap: anywhere; }
.tip__meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
             font-size: 11px; line-height: 1.35; color: var(--fg-mid); }
.tip__note { font-size: 11px; color: var(--fg-dim); line-height: 1.4; }

/* the first tip carries a breath of the accent */
.tip--sage {
  background-image: linear-gradient(180deg, rgba(var(--accent-rgb), .07), rgba(var(--accent-rgb), .02) 42%, transparent 72%);
  border-color: rgba(var(--accent-rgb), 0.26);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 0 0 1px rgba(var(--accent-rgb), 0.05),
    0 18px 50px -24px rgba(var(--accent-rgb), 0.22),
    0 22px 60px -30px rgba(0, 0, 0, 0.9);
}
```

---

## 9. Dashboard layout

The Dashboard is **not** a grid of panels. It's a **brief on the left** (prose and a short list) and a **deck on the right**: one card at a time that you page through with the wheel or the dots. The empty middle between them is deliberate. That is where the background light shows.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ● 3 cases / 42 logged                                                        │
│                                                       ·  ┌─              ─┐   │
│ Good evening.                                         ·                     │
│ Nothing is late. 15 open across 10 cases.             ●      ACTIVE CARD    │
│                                                       ·      (max 700px)    │
│ ▎ The clerk's brief, typed out…                       ·                     │
│   ON THE WIRE  second paragraph…                      ·  └─              ─┘   │
│                                                                              │
│ up next                                                                      │
│ ●  tomorrow  File the response …     Case name                               │
│ ●  fri 14    Call the client …       Case name                               │
└──────────────────────────────────────────────────────────────────────────────┘
  brief column: minmax(260px, 1fr)          dots      deck: auto, ≤700px, right-aligned
```

### Page grid

```css
.dash {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(0, auto);
  gap: 28px;
  align-items: stretch;
  min-width: 0;
  /* a definite height: the deck's cards are stacked absolutely */
  height: clamp(520px, calc(100dvh - var(--nav-h, 66px) - 120px), 900px);
}
```

The page sits in a shell: `max-width: 1560px; margin: 0 auto; padding: calc(var(--nav-h) + 18px) var(--shell-x) 48px;`, where `--nav-h` is the measured height of the fixed top bar.

### The brief column

```css
.dash__brief {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
  padding-top: 8px;
}

.dash__chip { align-self: flex-start; }      /* a .statpill.statpill--idle: "3 cases / 42 logged" */

.dash__greet {
  font-size: clamp(34px, 4vw, 52px);
  font-weight: 500;
  line-height: 1.02;
  letter-spacing: -0.03em;
  color: var(--text);
}
.dash__greet .serif { font-size: 1.05em; }   /* "Good <em class=serif>evening</em>." */

.dash__line {                                 /* one-line headline: what is true right now */
  max-width: 34ch;
  font-size: 14px;
  line-height: 1.55;
  color: var(--text-muted);
}

@media (max-height: 820px) { .dash__brief { gap: 10px; } }   /* short windows give up air, not content */
```

### The written brief (typed paragraph with an accent tick)

There's no box, fill or border around it. The only mark is a **2×15px accent tick** beside the first line, which says this text was written rather than counted.

```css
.dash__read {
  position: relative;
  margin: 2px 0 4px;
  padding-left: 13px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.dash__read::before {
  content: '';
  position: absolute;
  left: 0; top: 4px;
  width: 2px; height: 15px;
  border-radius: 2px;
  background: linear-gradient(to bottom, var(--accent-edge), rgba(var(--accent-rgb), 0.30));
}

.dash__readtext {
  margin: 0;
  max-width: 46ch;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-muted);
  text-wrap: pretty;
}
@media (max-height: 820px) { .dash__readtext { font-size: 13.5px; line-height: 1.62; } }
.dash__readtext--wait { color: var(--text-faint); }      /* "reading the archive…" */

/* second paragraph (the news) steps back a shade */
.dash__readnews { margin-top: 4px; color: var(--text-faint); }

/* inline kicker before it: "ON THE WIRE" */
.dash__readkicker {
  margin-right: 8px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
  opacity: 0.8;
  transition: opacity 300ms ease;
}
.dash__readkicker.is-waiting { opacity: 0; }   /* fades in when typing reaches it */

/* "read again": invisible until the brief is hovered or focused */
.dash__readagain {
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-faint); background: none; border: 0; padding: 0;
  opacity: 0; transition: opacity 220ms ease, color 220ms ease;
}
.dash__read:hover .dash__readagain,
.dash__read:focus-within .dash__readagain { opacity: 1; }
.dash__readagain:hover:not(:disabled) { color: var(--accent); }
```

**The typewriter.** The text types at **65 characters per second**, with beats after punctuation: newline +420ms, `. ? !` +220ms, `— – : ;` +140ms, `,` +70ms. A beat is only taken when the mark ends a word, so "3.5" and "e.g." keep typing. The untyped rest is **laid out but hidden** (`visibility: hidden`), so the paragraph has its final shape from the first frame and no word jumps lines mid-typing.

```html
<p class="dash__readtext">
  <span class="sr-only">Full text for screen readers.</span>
  <span aria-hidden="true">Typed so far<span class="typed__caret">&#8288;</span><span class="typed__rest">the rest, invisible</span></span>
</p>
```

```css
.typed__rest  { visibility: hidden; }

/* The caret is the span's LEFT BORDER around a word-joiner (U+2060): it has a
   line's height, takes no width, adds no break opportunity, and moves with
   every letter (an absolutely positioned ::after lags on iOS Safari). */
.typed__caret { border-left: 1.5px solid var(--accent); margin-right: -1.5px; }

/* done: two hard blinks, then gone. Never blink forever. */
.typed__caret.is-done { animation: typed-done 2s steps(1) forwards; }
@keyframes typed-done {
  0%, 50%        { opacity: 1; }
  25%, 75%, 100% { opacity: 0; }
}
```

### Up next (run-log list)

Monospace rows that line up as a block: a lit dot, when, what, and which case.

```css
.dash__up     { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; min-width: 0; }
.dash__uphead { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.14em;
                text-transform: lowercase; color: var(--text-faint); padding: 0 0 8px 2px; }

.dash__row {
  display: grid;
  grid-template-columns: 6px 68px minmax(0, 1fr) minmax(0, auto);
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 8px;
  margin: 0 -8px;                       /* hover well bleeds past the text edge */
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 11.5px;
  transition: background-color 200ms ease;
}
.dash__row:hover, .dash__row:focus-visible { background: var(--bg-elevated); }
.dash__when { color: var(--text-faint); }
.dash__what { color: var(--text); font-family: var(--font); font-size: 12.5px; }   /* the title is sans */
.dash__case { color: var(--text-faint); text-align: right; }
.dash__none { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-faint); padding: 4px 2px; }
```

Dot states: `status-dot--overdue` (red, pulsing) if late, `status-dot--live` (accent, pulsing) if due soon, plain faint dot otherwise.

### The deck

```css
.dash__deck {
  position: relative;
  display: grid;
  align-items: center;
  grid-template-columns: auto minmax(0, 700px);   /* dots | card */
  justify-content: end;                            /* hard against the right edge */
  gap: 14px;
  min-width: 0;
  outline: none;
}
.dash__deck:focus-visible .dash__stack {
  outline: 1px solid var(--accent-edge);
  outline-offset: 10px;
  border-radius: var(--radius);
}

/* The frame: a LANDSCAPE window with air above and below, not a full-height column. */
.dash__stack {
  grid-column: 2;
  position: relative;
  min-width: 0;
  height: clamp(420px, calc(100dvh - var(--nav-h, 66px) - 260px), 600px);
  perspective: 2200px;
  perspective-origin: 50% 50%;
}

/* Every card is mounted; only one is in front. Position is written per frame by script. */
.dash__slide {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;          /* each card is its own height, centred in the frame */
  opacity: 0;
  visibility: hidden;
  transform-origin: 50% 50%;
  will-change: transform, opacity;
}

.dash__card       { width: 100%; height: auto; max-height: 100%; min-height: 0; }
.dash__card--flow { height: 100%; }   /* the drawing keeps the whole frame */
```

**Deck motion** (scripted, no CSS transition). The deck has a continuous **position** that chases an **aim**: each frame it moves `pos += (aim - pos) × 0.19` and snaps when it's within 0.0015. A mouse-wheel notch (~90px of delta) is worth one card. Trackpad deltas accumulate toward the same 90. For each card at distance `d = i - pos`:

- `opacity = max(0, 1 - |d| × 1.15)`
- `transform = translateY(d × 62px) scale(1 - min(|d|, 1) × 0.055)`
- cards with `|d| > 1.3` are hidden outright (no style writes)

This makes a long scroll one continuous glide through the deck rather than a series of latched jumps. Keyboard: arrows page and the deck is focusable. Background cards are `inert` and `aria-hidden`.

### Deck dots

```css
.dash__dots { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; justify-content: center; gap: 10px; padding: 0 2px; }
.dash__dot {
  width: 6px; height: 6px; padding: 0; border: 0; border-radius: 50%;
  background: var(--border-strong);
  cursor: pointer;
  transition: background-color 200ms ease, transform 200ms ease, box-shadow 200ms ease;
}
.dash__dot:hover { background: var(--text-faint); transform: scale(1.3); }
.dash__dot.is-on { background: var(--accent); box-shadow: 0 0 10px 0 var(--accent-glow); transform: scale(1.3); }
```

### Narrow windows (≤1040px)

The brief stacks above the deck, and the deck takes the full width:

```css
@media (max-width: 1040px) {
  .dash        { grid-template-columns: minmax(0, 1fr); gap: 24px; height: auto; }
  .dash__deck  { height: clamp(460px, 68vh, 640px); grid-template-columns: auto minmax(0, 1fr); justify-content: stretch; }
  .dash__greet { font-size: clamp(28px, 7vw, 40px); }
}
```

---

## 10. The deck's cards, one by one

The order matters: the structure comes first, and the chat is one scroll away.

| # | Card | Head | Body |
|---|---|---|---|
| 1 | **Case structure** | none (the flow brings its own title bar) | Flow panel (§11). Foot: `Completion` + meter |
| 2 | **The clerk** | "The clerk" / "Reads the archive before it answers" | `card__body--flush` → chat (§12) |
| 3 | **Total workload** | "Total workload" / "Last 30 days", right: pill "Change module" (cycles 14/30/45) | `subpanels--3`: Opened · Closed · Overdue. Each has a label + trend + ⋯, mini bars 92px, then a metric "x.x / entries per day" |
| 4 | **Recommendations** | "Recommendations" / "Personalized tips for staying on top", right: ⋯ (All / Urgent only) | `tiplist` of up to three tips, the first `tip--sage`. Empty: "Nothing *urgent.*" |
| 5 | **Tracking** | "Tracking" / window label, right: ⋯ | `card__body--center`: one metric, "N entries", sub "M open in total" |
| 6 | **Detailed report** | "Detailed report" / "Entries logged per day", right: pill-select Week/Month | Week: week table. Month: mini bars + a micro row "30 days ago · x per day · Today" |
| 7 | **Completion rate** | "Completion rate", right: pill "Change" | Row: metric "NN%" + timeline dots (min 200px) |

---

## 11. The case-structure flow panel

A workflow window. A title bar holds the name and its measurements, the canvas has a tool strip down its left edge, and a log of recent runs sits along the bottom. Inside the canvas, a case is drawn as **HTML cards over one SVG of curved wires**.

### Frame

```css
.flow       { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.flow__bar  { flex: none; display: flex; align-items: center; gap: 12px; padding: 15px 18px 13px;
              border-bottom: 1px solid var(--line-soft); min-width: 0; }
.flow__name { font-size: 14px; font-weight: 500; letter-spacing: -0.015em; color: var(--text); }
.flow__count{ font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.01em;
              color: var(--text-faint); white-space: nowrap; }   /* "12 steps / 3 open / 1 late" */
.flow__state{ margin-left: auto; flex: none; }                    /* a .statpill */
.flow__body { flex: 1 1 auto; display: flex; align-items: stretch; gap: 10px; min-height: 0; padding: 12px 14px 4px; }
.flow__canvas { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; }
```

### Tool strip

```css
.flow__tools { flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; padding-top: 2px; }
.flow__tool {
  display: grid; place-items: center;
  width: 26px; height: 26px; padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease;
}
.flow__tool:hover:not(:disabled) { background: rgba(255,255,255,.07); color: var(--text); border-color: var(--border-strong); }
.flow__tool.is-on, .flow__tool[aria-expanded='true'] {
  background: var(--accent); border-color: var(--accent); color: var(--accent-ink);
  box-shadow: 0 0 16px -4px var(--accent-glow);
}
.flow__tool:disabled { opacity: 0.35; cursor: default; }
.flow__tool svg { width: 14px; height: 14px; }
.flow__orb { width: 16px; height: 16px; margin-top: 4px; border: 1px solid var(--border-strong); border-radius: 50%; }  /* idle mark */
```

### Wires

```css
.flow__scene { position: absolute; top: 0; left: 0; transform-origin: 0 0; }   /* laid out once, scaled as a piece */
.flow__wires { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; }
.flow__line  { fill: none; stroke: var(--border-strong); stroke-width: 1.25; transition: stroke 200ms ease; }
.flow__wire--subtask .flow__line { stroke-dasharray: 3 4; }      /* subtasks hang off, dashed */
.flow__port  { fill: var(--text-faint); transition: fill 200ms ease; }
.flow__wire[data-lit='hot'] .flow__line { stroke: var(--accent); }
.flow__wire[data-lit='hot'] .flow__port { fill: var(--accent); }
```

Wires are smooth cubic Béziers that leave a card horizontally and arrive horizontally, with a small port circle at each end.

### Step cards (nodes)

```css
.flow__node {
  position: absolute;
  display: flex; flex-direction: column; justify-content: center;
  gap: 3px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(var(--raised-rgb), 0.9);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.045), 0 14px 30px -18px rgba(0,0,0,.95);
  transition: border-color 200ms ease, box-shadow 200ms ease,
              transform 200ms cubic-bezier(0.22, 1, 0.3, 1), opacity 200ms ease;
}
.flow__head  { display: flex; align-items: center; gap: 7px; min-width: 0; }
.flow__dot   { width: 6px; height: 6px; flex: none; border-radius: 50%;
               background: var(--tone, var(--text-faint)); box-shadow: 0 0 8px 0 var(--tone-glow, transparent); }
.flow__title { font-size: 13px; font-weight: 500; letter-spacing: -0.01em; color: var(--text);
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.flow__sub   { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.01em; color: var(--text-faint);
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 13px; }  /* aligns under title, past the dot */

.flow__node--case { background: rgba(var(--raised-hi-rgb), 0.92); border-color: var(--border-strong); }
.flow__node--case .flow__title { font-size: 13.5px; }

/* state: the card sets --tone once, the dot reads it */
.flow__node--structure { --tone: var(--text-muted); }
.flow__node--normal    { --tone: var(--text); }
.flow__node--soon      { --tone: var(--amber); --tone-glow: rgba(227,179,65,.45); }
.flow__node--urgent    { --tone: var(--red);   --tone-glow: rgba(229,112,79,.45); }
.flow__node--overdue   { --tone: var(--red);   --tone-glow: rgba(229,112,79,.5); }
.flow__node--done      { --tone: var(--accent);--tone-glow: var(--accent-glow); }
.flow__node--done .flow__title { color: var(--text-muted); text-decoration: line-through; text-decoration-color: var(--border-strong); }
.flow__node--overdue .flow__sub { color: var(--red); }

/* hovering one step lifts it and dims the rest, so a branch can be followed */
.flow[data-hot] .flow__node            { opacity: 0.4; }
.flow[data-hot] .flow__node[data-lit]  { opacity: 1; }
.flow__node[data-lit='hot'] {
  transform: translateY(-1px);
  border-color: var(--accent-edge);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 16px 34px -16px rgba(0,0,0,.95), 0 0 26px -10px var(--accent-glow);
}
.flow__node:focus-visible { outline: 1px solid var(--accent-edge); outline-offset: 2px; }

/* branch label on a wire */
.flow__tag {
  position: absolute; transform: translate(-50%, -50%);
  padding: 1px 7px;
  border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--overlay);
  font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.04em; color: var(--text-faint);
  white-space: nowrap; pointer-events: none;
}
```

### Run log

```css
.flow__runs    { flex: none; display: flex; flex-direction: column; gap: 1px; padding: 8px 18px 14px; }
.flow__runhead { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.16em; color: var(--text-faint); opacity: 0.7; padding-bottom: 4px; }  /* "LAST RUNS" */
.flow__run     { display: grid; grid-template-columns: 6px auto minmax(0, 1fr); align-items: center; gap: 9px;
                 font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); }
.flow__runat   { color: var(--text-muted); }
```

### Depth: the drawing stands off the glass

This is the screen's one piece of real 3D. A card can't be both a 3D space and a clipping or blurring box (`overflow: hidden` and `backdrop-filter` both flatten their children). So the flow card hands its glass to a `::before` layer at z = 0, and the drawing floats above it as one plane, like a sheet of acetate.

```css
.flowcard {
  overflow: visible;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  transform-style: preserve-3d;
  --graph: 88px;                 /* drawing height above the glass on the dashboard (130px elsewhere) */
}
.flowcard::before {              /* the glass, moved one element down */
  content: '';
  position: absolute; inset: 0;
  border-radius: var(--radius);
  background: rgba(var(--panel-rgb), 0.72);
  -webkit-backdrop-filter: var(--panel-blur); backdrop-filter: var(--panel-blur);
  border: 1px solid transparent;
  box-shadow: 0 22px 60px -30px rgba(0, 0, 0, 0.92);
  pointer-events: none;
}
/* every layer between card and nodes passes 3D through */
.flowcard > .flow, .flowcard .flow__body, .flowcard .flow__canvas, .flowcard .flow__scene { transform-style: preserve-3d; overflow: visible; }

.flowcard .flow__bar   { transform: translateZ(3px); }
.flowcard .flow__tools { transform: translateZ(8px); }
.flowcard .flow__runs  { transform: translateZ(3px); }
.flowcard > .card__foot{ transform: translateZ(2px); border-top: 1px solid var(--line-soft); }
.flowcard .flow__wires { transform: translateZ(var(--graph)); }
.flowcard .flow__tag   { transform: translateZ(calc(var(--graph) + 4px)); }

.flowcard .flow__node {
  transform: translateZ(var(--lift));
  background: rgba(var(--solid-rgb), 0.96);       /* nearly solid over nearly-clear glass = reads as lifted */
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 2px 6px -2px rgba(0,0,0,.7), 0 34px 56px -20px rgba(0,0,0,.98);
}
.flowcard .flow__node--case    { --lift: calc(var(--graph) + 5px);  background: rgba(var(--solid-hi-rgb), .97); }
.flowcard .flow__node--entry   { --lift: calc(var(--graph) + 10px); }
.flowcard .flow__node--subcase { --lift: calc(var(--graph) + 8px); }
.flowcard .flow__node--subtask { --lift: calc(var(--graph) + 14px); }
.flowcard .flow__node[data-lit='hot'] {
  transform: translateZ(calc(var(--lift) + 28px));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 3px 7px -2px rgba(0,0,0,.65),
              0 40px 60px -26px rgba(0,0,0,.98), 0 0 36px -14px var(--accent-glow);
}
```

**Pointer tilt.** The panel is flat at rest. Under the pointer it turns toward it. `--gx` and `--gy` (−1…1, the pointer position on the card) are written by script and registered as non-inheriting:

```css
@property --gx { syntax: '<number>'; inherits: false; initial-value: 0; }
@property --gy { syntax: '<number>'; inherits: false; initial-value: 0; }

.card:has(.flow) {
  transform: rotateY(0deg);
  transition: transform 520ms cubic-bezier(0.22, 1, 0.3, 1), box-shadow 520ms ease;   /* leaves reluctantly */
}
.card:has(.flow)[data-tilt='on'] {
  transform: rotateY(calc(var(--gx) * 10deg)) rotateX(calc(var(--gy) * -8deg)) translateZ(24px);  /* FIXED lift, not proportional */
  transition: transform 220ms cubic-bezier(0.22, 1, 0.3, 1), box-shadow 220ms ease;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 40px 90px -36px rgba(0,0,0,.95), 0 0 50px -24px var(--accent-glow);
  z-index: 2;
}
```

Clicking the dashboard's drawing cycles to the next case (`cursor: pointer`).

---

## 12. The clerk (chat) card

No assistant-bubble vocabulary: no avatars, speech tails or gradients. The chat is a list of labelled turns inside an ordinary card.

```css
.chat     { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.chat__log{ flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
            padding: 2px 22px 10px; display: flex; flex-direction: column; gap: 14px;
            scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
.chat__log::-webkit-scrollbar { width: 6px; }
.chat__log::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 999px; }

/* empty state: a lead and seed questions */
.chat__opening { display: flex; flex-direction: column; gap: 12px; margin: auto 0; }
.chat__lead    { margin: 0; max-width: 44ch; font-size: 13px; line-height: 1.6; color: var(--text-muted); }
.chat__seeds   { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.chat__seed    { font-size: 12.5px; line-height: 1.3; text-align: left; color: var(--text-muted);
                 background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-pill);
                 padding: 6px 13px; transition: color 200ms ease, border-color 200ms ease, background-color 200ms ease; }
.chat__seed:hover { color: var(--text); border-color: var(--accent-edge); background: var(--accent-faint); }

/* a turn: label above, text below */
.chat__turn { display: flex; flex-direction: column; gap: 3px; }
.chat__who  { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-faint); }
.chat__turn--assistant .chat__who { color: var(--accent); }      /* "CLERK" in accent, "YOU" faint */
.chat__text { margin: 0; font-size: 13px; line-height: 1.62; color: var(--text); white-space: pre-wrap; text-wrap: pretty; overflow-wrap: anywhere; }
.chat__turn--user .chat__text { color: var(--text-muted); }

/* rendered markdown in replies */
.chat__text--md { white-space: normal; }
.chat__text--md > * + * { margin-top: 0.6em; }
.chat__text--md ul, .chat__text--md ol { padding-left: 1.25em; }
.chat__text--md li::marker { color: var(--text-faint); }
.chat__text--md strong { font-weight: 600; color: var(--text); }
.chat__text--md code { font-family: var(--font-mono); font-size: 0.9em; padding: 0 0.3em; border-radius: 4px; background: rgba(var(--text-rgb), 0.08); }

/* thinking: three accent dots */
.chat__dots   { display: inline-flex; gap: 4px; align-items: center; height: 1.62em; }
.chat__dots i { width: 4px; height: 4px; border-radius: 50%; background: var(--accent); opacity: .35; animation: chat-think 1200ms ease-in-out infinite; }
.chat__dots i:nth-child(2) { animation-delay: 160ms; }
.chat__dots i:nth-child(3) { animation-delay: 320ms; }
@keyframes chat-think { 0%,100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }

.chat__error { margin: 0; font-size: 12px; line-height: 1.5; color: var(--hot); }

/* composer: an underline field and a round send button */
.chat__ask   { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 11px 22px 16px; border-top: 1px solid var(--line-soft); }
.chat__input { flex: 1 1 auto; min-width: 0; font: inherit; font-size: 13px; color: var(--text);
               background: transparent; border: 0; border-bottom: 1px solid var(--border); padding: 6px 2px;
               transition: border-color 200ms ease; }
.chat__input::placeholder { color: var(--text-faint); }
.chat__input:focus { outline: none; border-bottom-color: var(--text); box-shadow: none; }   /* white line, no halo */
.chat__send  { flex: none; display: inline-flex; align-items: center; justify-content: center;
               width: 27px; height: 27px; border-radius: 50%;
               border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted);
               transition: color 200ms ease, background-color 200ms ease, border-color 200ms ease; }
.chat__send:hover:not(:disabled) { color: var(--accent-ink); background: var(--accent); border-color: var(--accent); }
.chat__send:disabled { opacity: 0.35; pointer-events: none; }
```

**Staged changes** (when the clerk proposes edits). This is a quiet box inside the reply:

```css
.chat__changes     { margin-top: 6px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);
                     background: rgba(255,255,255,.02); display: flex; flex-direction: column; gap: 8px; }
.chat__change      { display: grid; grid-template-columns: auto 52px minmax(0, 1fr); align-items: start; gap: 8px; font-size: 12.5px; line-height: 1.45; }
.chat__changetick  { width: 15px; height: 15px; border-radius: 4px; border: 1px solid var(--border-strong); background: transparent; color: var(--accent-ink); }
.chat__changetick[aria-checked='true'] { background: var(--accent); border-color: var(--accent); }
.chat__changeop    { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-faint); }
.chat__apply, .chat__dismiss { font-family: var(--font-mono); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; border-radius: 999px; padding: 4px 10px; }
.chat__apply   { border: 1px solid var(--accent); background: var(--accent); color: var(--accent-ink); }
.chat__dismiss { border: 1px solid var(--border-strong); background: transparent; color: var(--text-muted); }
```

Delete rows are shown at full text strength with a strikethrough, **not red**, because red means overdue.

---

## 13. Top chrome: status readout and island menus

There's **no top bar.** The page runs to the top of the window. A status pill sits in the top-left corner, aligned to the page margin, with glass of its own:

```css
.topbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 40;
  display: flex; justify-content: center; align-items: flex-start;
  padding: 14px var(--shell-x) 18px;
  background: none; border: 0;
  pointer-events: none;            /* the space belongs to the page */
}
.topbar__standing {                /* a .statpill: "● all systems normal" / "● 2 overdue" */
  position: absolute; top: 18.5px; left: var(--shell-x);
  pointer-events: none;
  background: rgba(var(--panel-rgb), 0.62);
  backdrop-filter: blur(16px) saturate(1.15);
}
```

Navigation is the **menu wheel** (§14): hold **Alt** on desktop, or long-press the floating button on a phone.

### Island dropdowns (every menu, select and date picker)

The dropdown opens *in place of* the control that opened it, as a dark-glass "island" that grows on a spring. The options come into focus one after another.

```css
.island-pop {
  position: fixed; z-index: 500; overflow: hidden;
  background: rgba(var(--panel-rgb), 0.66);
  backdrop-filter: var(--panel-blur);
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: 0 26px 60px -16px rgba(0, 0, 0, 0.78);
  color: var(--text);
}
.island-pop.is-folding .island__body { opacity: 0; transition: opacity 120ms ease; }   /* contents go first */
[data-island-present='true'] { opacity: 0 !important; }                                /* the trigger steps aside */

.island-menu       { display: flex; flex-direction: column; gap: 1px; padding: 6px; min-width: max-content; }
.island-menu__item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  min-height: 34px; padding: 0 10px 0 12px;
  border: 0; border-radius: 12px; background: transparent;
  color: var(--fg-mid); font-size: 13px; line-height: 1.2; text-align: left; white-space: nowrap;
  transition: color 160ms ease, background-color 160ms ease;
  animation: island-option-in 420ms var(--pn-open) both;
  animation-delay: calc(70ms + var(--i) * 24ms);           /* --i = option index */
}
@keyframes island-option-in {
  from { opacity: 0; filter: blur(5px); transform: translateY(-4px) scale(0.97); }
  to   { opacity: 1; filter: none; transform: none; }
}
.island-menu__item:hover, .island-menu__item:focus-visible { color: var(--text); background: rgba(255,255,255,.06); }
.island-menu__item:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--accent-edge); }
.island-menu__item.is-current { color: var(--text); }
.island-menu__item.is-danger  { color: var(--hot); }
.island-menu__item.is-danger:hover { background: var(--hot-soft); }
.island-menu__mark { flex: none; display: inline-flex; width: 14px; justify-content: center; color: var(--accent); }  /* ✓ */
.island-menu__meta { flex: none; color: var(--fg-dim); font-family: var(--font-mono); font-size: 11px; }
.island-menu__sep  { height: 1px; margin: 4px 8px; background: var(--border); }
```

The island's width and height are animated from script, from the trigger's rect to the menu's rect. It stretches sideways first, then drops, using `--pn-open`. Closing pulls up, then narrows, using `--pn-close`. See §15 for the springs.

---

## 14. The menu wheel

A radial navigation overlay. **Desktop:** hold **Alt**, point at a section, release to go. **Phone:** long-press the floating to-do button (or press and slide off it), slide to a section, lift to go. It's drawn in a 380×380 SVG viewBox.

**Geometry (viewBox units, centre 190,190):**
- Hub ring: r = **30**, stroke white 86%, 1.1 wide. Behind it, a **halo** at r = 33, accent, stroke 4, 16% opacity, Gaussian blur σ 4.5.
- The **rim's thick run**: an arc on the hub circle (r = 30) spanning ±16° toward the selected section, white, stroke 2.8.
- The **lit wedge**: a ring sector from r = **70** to r = **125**, spanning one section minus a 1.6° gap. Fill accent at 20%, stroke accent at 75%, 0.7 wide, round joins.
- **Sections**: icon 18px plus a label (11px, white 55%; icon white 78%) at r = **97**. The hot or current section turns pure white.
- The **band** (the ring the sections sit in) is translucent dark glass from r 70→125, cut into segments with a 1.6° gap between each.

```css
.navwheel        { position: fixed; inset: 0; z-index: 300; display: grid; place-items: center; touch-action: none; user-select: none; }
.navwheel__ground{ position: absolute; inset: 0; background: rgba(1, 2, 2, 0.85); opacity: 0;
                   transition: opacity 180ms ease 140ms; }                       /* leaving: after the wheel */
.navwheel.is-shown .navwheel__ground { opacity: 1; transition: opacity 120ms ease; }   /* arriving: first */

.navwheel__disc  { position: relative; width: min(94vw, 506px); aspect-ratio: 1; opacity: 0; transition: opacity 160ms ease 60ms; }
.navwheel.is-shown .navwheel__disc { opacity: 1; transition: opacity 120ms ease; }

/* grows out of the hub on the open spring */
.navwheel__band, .navwheel__drawing { transform: scale(0.5); transition: transform 220ms var(--pn-close); }
.navwheel.is-shown .navwheel__band,
.navwheel.is-shown .navwheel__drawing { transform: none; transition: transform 560ms var(--pn-open); }

.navwheel__band {
  position: absolute; inset: calc(65 / 380 * 100%); border-radius: 50%;
  background: rgba(2, 4, 5, 0.32);
  backdrop-filter: blur(6px) saturate(1.1);
  /* ring mask ∩ segment mask; --seg = 360/N deg, --gap = 1.6deg */
  mask:
    radial-gradient(closest-side, transparent 55.9%, #000 56.1%),
    repeating-conic-gradient(from calc(var(--seg) / 2 + var(--gap) / 2),
      #000 0deg calc(var(--seg) - var(--gap)), transparent calc(var(--seg) - var(--gap)) var(--seg));
  mask-composite: intersect;
}

/* wedge + rim turn together, the short way round */
.navwheel__mover { transform-box: view-box; transform-origin: 190px 190px;
                   transition: transform 190ms cubic-bezier(0.25, 0.9, 0.35, 1), opacity 140ms ease; }
.navwheel__wedge { fill: rgba(var(--accent-rgb), .2); stroke: rgba(var(--accent-rgb), .75); stroke-width: .7; stroke-linejoin: round; }
.navwheel__halo  { fill: none; stroke: rgb(var(--accent-rgb)); stroke-width: 4; opacity: .16; }
.navwheel__hub   { fill: none; stroke: rgba(255,255,255,.86); stroke-width: 1.1; }
.navwheel__rim   { fill: none; stroke: #fff; stroke-width: 2.8; }

/* sections fly out from 24px toward the centre, staggered round from the top */
.navwheel__item {
  display: grid; justify-items: center; gap: 5px; padding: 6px 8px;
  border: 0; border-radius: 8px; background: transparent;
  color: rgba(255,255,255,.55); font: 400 11px/1.2 var(--font); white-space: nowrap;
  opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.8);
  transition: opacity 120ms ease, transform 200ms ease, color 140ms ease;
}
.navwheel.is-shown .navwheel__item {
  opacity: 1; transform: none;
  transition:
    opacity   260ms ease                 calc(var(--i) * 28ms + 60ms),
    transform 520ms var(--pn-open)       calc(var(--i) * 28ms + 40ms),
    color     140ms ease;
}
.navwheel__item svg { width: 18px; height: 18px; color: rgba(255,255,255,.78); transition: color 140ms ease; }
.navwheel__item.is-hot, .navwheel__item.is-hot svg, .navwheel__item.is-current { color: #fff; }
@media (max-width: 640px) { .navwheel__item { font-size: 12px; gap: 6px; } .navwheel__item svg { width: 21px; height: 21px; } }
```

**Behaviour:**
- Whatever the pointer's direction from the centre, the section in that direction is selected. Distance from the centre doesn't matter.
- It must open on the **first frame** of the key press.
- Before adding `.is-shown`, force a layout (read `offsetWidth`) so the folded state is committed. Otherwise the open animation is skipped and the wheel pops.
- Leaving takes about 320ms: the wheel goes first, then the ground lifts.

---

## 15. Motion system

### Easings

| Name | Curve | Use |
|---|---|---|
| `--e-arrive` | `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out) | every build-in arrival |
| UI ease | `cubic-bezier(0.22, 1, 0.3, 1)` | pills, node lift, card tilt |
| Wheel glide | `cubic-bezier(0.25, 0.9, 0.35, 1)` | the wheel's selection, 190ms |
| `--pn-open` | damped spring, bounce 0.32 (≈5% overshoot), as `linear()` | islands opening, wheel opening |
| `--pn-close` | damped spring, bounce 0.12, as `linear()` | islands closing |
| fallbacks | open `cubic-bezier(0.34, 1.3, 0.64, 1)` · close `cubic-bezier(0.32, 0.72, 0, 1)` | engines without `linear()` |

**Generating the springs** (sample a damped spring into a CSS `linear()` easing and set it as a custom property on the root):

```js
export function springEasing(bounce, samples = 40) {
  const zeta = 1 - bounce;              // damping ratio
  const omega = 6.9 / zeta;             // settles to 0.1% at t = 1
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const decay = Math.exp(-zeta * omega * t);
    const x = 1 - decay * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    pts.push(i === samples ? 1 : Number(x.toFixed(4)));
  }
  return `linear(${pts.join(', ')})`;
}
// --pn-open: springEasing(0.32)   --pn-close: springEasing(0.12)
```

### Durations

- **Hover and colour changes:** 140–220ms.
- **Focus and selection:** 200ms.
- **Arrivals:** 460–820ms.
- **Island open:** ~560ms on the spring.
- **Island close:** ~220ms.
- **Nothing is slower than 820ms.**

### Screen build ("screens are built, not faded")

Each navigation remounts the view with a React `key`, which replays the sequence. The view carries `.is-building` for the length of the build.

```css
:root { --e-arrive: cubic-bezier(0.16, 1, 0.3, 1); }

@keyframes bld-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes bld-rise { from { opacity: 0; transform: translate3d(0, 14px, 0); } to { opacity: 1; transform: none; } }
@keyframes bld-grow { from { transform: scaleY(0.03); } to { transform: scaleY(1); } }
@keyframes bld-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes bld-pop  { from { opacity: 0; transform: scale(0.55); } to { opacity: 1; transform: scale(1); } }
@keyframes dash-stand {
  from { opacity: 0; transform: translate3d(34px, 12px, 0) scale(0.97); }
  to   { opacity: 1; transform: none; }
}

/* the Dashboard reads left to right; the panel stands up last */
.view.is-building .dash__chip  { animation: bld-rise   460ms var(--e-arrive)  40ms both; }
.view.is-building .dash__greet { animation: bld-rise   560ms var(--e-arrive) 100ms both; }
.view.is-building .dash__line  { animation: bld-rise   520ms var(--e-arrive) 200ms both; }
.view.is-building .dash__up    { animation: bld-rise   540ms var(--e-arrive) 280ms both; }
.view.is-building .dash__stack { animation: dash-stand 820ms var(--e-arrive) 220ms both; }
.view.is-building .dash__dots  { animation: bld-fade   600ms var(--e-arrive) 620ms both; }

/* data grows into place after its card (--d = the card's own delay) */
.view.is-building .minibars    { transform-origin: bottom;      animation: bld-grow 560ms var(--e-arrive) calc(var(--d) + 330ms) both; }
.view.is-building .meter__fill { transform-origin: left center; animation: bld-fill 760ms var(--e-arrive) calc(var(--d) + 400ms) both; }
.view.is-building .tip              { animation: bld-rise 460ms var(--e-arrive) calc(var(--d) + 300ms) both; }
.view.is-building .tip:nth-child(2) { animation-delay: calc(var(--d) + 360ms); }
.view.is-building .tip:nth-child(3) { animation-delay: calc(var(--d) + 415ms); }
.view.is-building .weektable__col   { animation: bld-rise 420ms var(--e-arrive) both; }   /* +35ms per column from --d+300ms */
.view.is-building .timelinedots__dot{ animation: bld-pop  380ms var(--e-arrive) both; }   /* +45ms per dot from --d+360ms */
```

**Build rules:**
- Animate **whole charts**, not their bars. One `scaleY` on the SVG matches thirty per-bar transforms pixel for pixel, at a thirtieth of the cost.
- Never wipe with `clip-path`. It can't be composited and re-rasterises every frame.
- Never put an `opacity` animation on an element that holds a `preserve-3d` subtree. It flattens the 3D. Fade the flat leaves instead.
- `both` fill-mode, and the resting state is the final state, so a skipped animation fails safe.

### Typing caret

Solid while typing, then exactly two hard blinks (`steps(1)`), then gone (§9).

---

## 16. Responsive and touch

| Breakpoint | Change |
|---|---|
| `max-height: 820px` | brief gaps 18→10px, brief text 15→13.5px |
| `max-width: 1040px` | brief stacks over the deck, deck full-width at `clamp(460px, 68vh, 640px)`, greeting `clamp(28px, 7vw, 40px)` |
| `max-width: 760px` | `--shell-x: 14px`, `--pad: 16px`, bento to one column, smaller week-table cells |
| `max-width: 640px` (phone) | see below |

**Phone (≤640px):**
- **The deck runs sideways.** Cards sit side by side 18px apart. A swipe of 40px or more turns the card, and anything less settles back. Per card: `opacity = 1 - |d| × 0.6`, `translateX(d × (width + 18px))`. Dots go in a **row under** the deck. `touch-action: pan-y` on the deck *and everything inside it*, so vertical drags still scroll the page.
  ```css
  .dash__deck  { grid-template-columns: 1fr; grid-template-rows: auto auto; row-gap: 16px; height: auto; touch-action: pan-y; }
  .dash__stack { grid-column: 1; grid-row: 1; height: clamp(440px, 72dvh, 620px); }
  .dash__dots  { grid-column: 1; grid-row: 2; flex-direction: row; }
  .dash__deck * { touch-action: pan-y; }
  .dash__slide > .card { max-height: 100%; }
  .dash__slide > .card > .card__body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  ```
- **Up-next rows become two lines:** the title in full at 14px, then *when* and *case* underneath.
  ```css
  .dash__row { grid-template-columns: 6px minmax(0, 1fr) auto; grid-template-areas: 'dot what what' 'dot when case';
               row-gap: 3px; column-gap: 10px; padding: 10px 8px; }
  .dash__row > .status-dot { grid-area: dot; align-self: start; margin-top: 7px; }
  .dash__row > .dash__what { grid-area: what; white-space: normal; font-size: 14px; }
  .dash__row > .dash__when { grid-area: when; }
  .dash__row > .dash__case { grid-area: case; }
  ```
- Dashboard cards are **bare** (no glass), with corners only.
- No text smaller than 11px.

**Touch devices** (`(hover: none) and (pointer: coarse)`):
- Tap targets of at least 34–36px. Small controls (dots, ⋯, tool buttons) get an invisible `::before` reach of `inset: -10px` (−17px for deck dots).
- No 3D tilt or perspective (`transform: none` on `.card:has(.flow)`).
- Glass panels become near-solid instead of live-blurred, because a phone GPU can't re-blur twenty panels per scrolled frame.
- **Important:** some desktop PCs report `hover: none` / `coarse`. Set a `data-mouse` attribute on `<html>` on the first real `mousemove`, and gate the touch-only degradations on `html:not([data-mouse])`.

---

## 17. Accessibility and reduced motion

- Honour both `prefers-reduced-motion: reduce` and a manual `[data-motion='reduced']` on `<html>`. Under either:
  - build animations off;
  - deck jumps instead of gliding;
  - no typewriter (full text at once) and no caret;
  - the flow stays flat (`transform-style: flat`, nodes `transform: none`);
  - tilt off;
  - thinking dots static at 55%.
- Focus rings are `1px solid var(--accent-edge)` with an offset of 2px on small items and 10px around the deck. There are no browser halos inside cards. Text fields show focus by turning their underline white.
- The deck is a `section` with `aria-roledescription="carousel"` and is keyboard-focusable. Background slides are `inert` and `aria-hidden`. Dots are buttons with `aria-label` and `aria-current`.
- Typed text has an `sr-only` full copy, and the animated copy is `aria-hidden`.
- Status is never colour alone. Every dot sits next to words ("2 overdue", "tomorrow").

---

## 18. Performance rules (learned the hard way)

These are not optional. The style depends on lots of backdrop blur, and blur is expensive.

1. **Every repainted frame re-blurs every glass panel on screen.** Any perpetual animation, however small, keeps the GPU busy. A single smooth-pulsing 6px dot held the GPU at ~80% on an idle page. So:
   - status pulses use `steps(6, jump-none)`;
   - the caret blinks twice and stops;
   - nothing loops smoothly forever except the thinking dots, which only run while waiting.
2. **Never animate `color-mix()`** or other computed colours per frame. Resolve tokens to `rgb()` once.
3. **Don't write per-frame custom properties on `<html>`.** Changing a root variable restyles the whole document (20–30ms a frame). Write them on the element that reads them, and register them `inherits: false` with `@property`.
4. **Opacity flattens `preserve-3d`.** Fade leaves, never the 3D container.
5. **Deck positions are written straight to element styles** in a rAF loop. React state only changes once per settled card.
6. **Hidden cards beyond reach** (`|d| > 1.3`) get `visibility: hidden` and no further style writes.
7. On touch screens, replace live blur with near-solid fills.

---

## 19. Do / don't

**Do**
- Use the accent for one live thing per area: an active pill, a lit dot, the selected dot, a hovered wire.
- Keep cards nearly square (3px) with white corner brackets and no outline.
- Set readouts and labels in lowercase Geist Mono, in faint ink.
- Italicise **one** word in Instrument Serif when a line needs a change of voice.
- Let large numbers be large and *light* (40px / 400).
- Build screens in reading order on expo-out, and finish within 820ms.

**Don't**
- Colour charts with the accent. Data ink is neutral.
- Add borders, gradients or avatars to chat messages.
- Use red or amber for anything except overdue or soon. Delete is not red.
- Bold headings (max 500) or use more than three faces.
- Bounce content. Springs are for islands and the wheel only.
- Run any smooth infinite animation over glass.
- Show a spinner for a wait of a few milliseconds. Leave the space empty.

---

## 20. Starter markup

```html
<html data-accent="turquoise">
<body>
  <header class="topbar">
    <span class="statpill statpill--ok topbar__standing">all systems normal</span>
  </header>

  <main class="shell">
    <div class="view is-building">
      <div class="dash">

        <!-- left: the brief -->
        <aside class="dash__brief">
          <span class="statpill statpill--idle dash__chip">3 cases / 42 logged</span>
          <h1 class="dash__greet">Good <em class="serif">evening</em>.</h1>
          <p class="dash__line">Nothing is late. 15 open across 10 cases.</p>

          <div class="dash__read">
            <p class="dash__readtext">Two filings are due before Friday; start with the response…</p>
            <p class="dash__readtext dash__readnews">
              <span class="dash__readkicker">on the wire</span>A short line of relevant news.
            </p>
            <button class="dash__readagain" type="button">read again</button>
          </div>

          <div class="dash__up">
            <span class="dash__uphead">up next</span>
            <button class="dash__row" type="button">
              <span class="status-dot status-dot--live"></span>
              <span class="dash__when">tomorrow</span>
              <span class="dash__what truncate">File the response</span>
              <span class="dash__case truncate">Case name</span>
            </button>
          </div>
        </aside>

        <!-- right: the deck -->
        <section class="dash__deck" tabindex="0" aria-roledescription="carousel" aria-label="Dashboard cards">
          <div class="dash__stack">
            <div class="dash__slide is-on">
              <article class="card dash__card" aria-label="Tracking">
                <div class="card__head">
                  <div class="card__headtext">
                    <h2 class="card__title">Tracking</h2>
                    <p class="card__sub">This week</p>
                  </div>
                  <div class="card__right">
                    <button class="iconmenu" aria-label="Tracking window">
                      <i class="iconmenu__dot"></i><i class="iconmenu__dot"></i><i class="iconmenu__dot"></i>
                    </button>
                  </div>
                </div>
                <div class="card__body card__body--center">
                  <div class="metric">
                    <div class="metric__value"><span class="metric__num">12</span><span class="metric__unit">entries</span></div>
                    <div class="metric__sub">15 open in total</div>
                  </div>
                </div>
              </article>
            </div>
            <!-- more .dash__slide … -->
          </div>

          <nav class="dash__dots" aria-label="Choose a card">
            <button class="dash__dot is-on" aria-current="true" aria-label="Tracking"></button>
            <button class="dash__dot" aria-label="Detailed report"></button>
          </nav>
        </section>

      </div>
    </div>
  </main>
</body>
</html>
```

Add `.utility` helpers as needed: `.truncate { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`, `.nowrap`, `.grow { flex: 1 1 auto; }`, and `.sr-only` (the standard visually-hidden pattern).

---

*Source of truth: `src/styles.css`, `src/motion.css`, `src/mobile.css`, `src/ui/NavWheel.css`, `src/ui/IslandMenu.css`, `src/ui/useDeck.js`, `src/ui/useTypewriter.js`, `src/ui/island.js`, `src/views/Dashboard.jsx`. The background (streak, dot grid, vignette) is documented separately.*
