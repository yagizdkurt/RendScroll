# How to Convert a Campaign into RendScroll

This document is a complete conversion contract for an AI that already knows the
source campaign's lore, locations, characters, encounters, clues, and event order.
Its job is to transform that campaign into a self-contained RendScroll campaign
without inspecting RendScroll's source code.

The final deliverable is not a prose summary of the source campaign. It is a set
of UTF-8 Markdown files and optional local assets that a GM can import into
RendScroll and run at the table.

## 1. Non-negotiable rules

1. Preserve the source campaign's facts, causality, tone, choices, and intended
   reveals. Do not silently invent lore, statistics, clues, or outcomes.
2. Organize play in the order the GM will need information at the table. Do not
   organize scenes like an encyclopedia.
3. Use the exact English structural keywords documented here even when the
   campaign's prose is in another language. Titles, narration, dialogue, clues,
   and notes may remain in the source language.
4. Produce one Markdown file per runnable scene or scene-sized unit. Do not put
   an entire campaign into one giant file.
5. Use `#` once for the scene title, `##` for playable events, and only supported
   `###` headings for RendScroll cards.
6. Put player-facing read-aloud text in a `### Narrative` card. Put GM-only truth
   in ordinary prose, lists, or short inline-code notes.
7. Keep reusable items and enemies in their library folders. Keep campaign-wide
   background material in lore pages. Do not duplicate the same full definition
   in every scene.
8. Represent real branches with `### Transition:` cards whose `Scene:` value
   exactly matches a target scene filename stem.
9. Every reference must resolve. Every referenced local asset must be included.
   An `Image:`, `BG:`, or `File:` line whose target you are not shipping is worse
   than no line at all — omit the directive. "Pending asset" is not a state a
   delivered package may be in.
10. Never emit ellipses, placeholders, `TODO`, "same as above," or omitted file
    bodies in the final deliverable.
11. Classify before you structure. Book order is not gameplay order; only
    genuinely playable beats become `##` events. See Stage C.
12. One fact, one home. If a destination, condition, or statistic belongs to a
    scene, put it in that scene; do not restate it in a second document that also
    claims to own it.

## 2. Inputs and the conversion pipeline

### Stage A — Normalize the source

If the source is PDF, scans, images, HTML, a wiki export, or another non-plain
format, first convert it to plain Markdown. Preserve:

- heading hierarchy and original order;
- boxed/read-aloud text;
- stat blocks, DCs, damage, rewards, and encounter quantities;
- tables whose relationships matter;
- captions and references to maps, portraits, handouts, and audio;
- sidebars, secrets, prerequisites, consequences, and branch conditions;
- page or section identifiers that help trace facts back to the source.

Repair OCR errors before adapting the material. Do not infer a new fact merely
because OCR made the old fact unreadable. Record unresolved source ambiguity in a
conversion report outside the import folder, or as a concise GM note if it must
remain visible during play.

### Stage B — Build a campaign truth model

Before writing RendScroll files, extract a private working model with at least:

- the campaign premise and expected player objective;
- chronological events and prerequisite relationships;
- branch points, convergence points, optional routes, and fail-forward routes;
- locations and what changes in them over time;
- NPC goals, knowledge, lies, dialogue topics, and reveal conditions;
- clues, where each clue first appears, and where it can move if missed;
- encounters, enemy counts, tactics, and environmental mechanics;
- reusable items and enemies;
- campaign-wide lore, factions, history, cosmology, and prophecies;
- rewards, costs, deadlines, rests, and escalation states;
- every asset and the content that uses it.

Resolve contradictions only when the source itself resolves them. Otherwise keep
the ambiguity explicit for the GM.

### Stage C — Classify every section before deciding what is a scene

**This stage is mandatory and it is the one converters skip.** Do it before the
scene matrix, in writing, for every heading in the source.

A published adventure's layout hierarchy and a play session's temporal hierarchy
are different things. A book puts the villain's history first because a reader
needs it first. That is not the villain attacking the party in scene one.

**Never equate book order with gameplay order.**

Before anything becomes an event, answer one question:

> If a GM were running this at the table, would this happen **to or around the
> player characters** at this point?

If the answer is no, it is not an event. It does not become one merely because it
occupies a heading between two things that are.

#### The classification table

Assign every source section exactly one category, then use the mapping in the last
column. Nothing else is a legitimate conversion target.

| # | Category | What it is | RendScroll representation |
|---|---|---|---|
| A | GM preparation / background | History, cosmology, why a villain behaves as they do | `lore/` entries. A no-event scene may link to them as a dashboard. |
| B | Persistent NPC / campaign state | Standing objectives active across many scenes ("he wants Ireena") | `lore/` entries stated as ongoing state, not as a sequence. |
| C | Roleplaying guidance | How to portray someone whenever they appear | The NPC's `lore/` record. Not an encounter. |
| D | Reusable procedure | "When X attacks" — what happens whenever a recurring situation occurs | A `lore/` entry, or an `### STD:` note where it is used. Not a scheduled event. |
| E | Preparation procedure | An ordered thing the GM performs outside play (a pre-game card draw, a random-table roll-up) | `## Step 1:`, `## Step 2:` … in a clearly labelled preparation scene. **Ordered, but not Events.** |
| F | Actual playable scene | Something that occurs at the table | `## Event 1:`, `## Event 2:` … This is the only category that earns an Event. |
| G | Player read-aloud | Text the source intends to be spoken to the players | `### Narrative` + `Text:` + `>`. |
| H | Lookup / reference table | Treasure tables, card meanings, possible allies, encounter tables | One `lore/` page with a lookup entry. **Never one scene per row.** |

#### Traps this table exists to prevent

- **Prose order becoming event order.** Four consecutive book sections about a
  villain are not Events 1–4. A GM cannot point at "Event 3: The Vampire's History"
  and say "this is what is happening right now."
- **A lookup table exploding into scenes.** Forty possible card results are forty
  rows of one lookup, consulted once. They are not forty scenes, and they are not
  forty `##` events inside one scene either.
- **A preparation procedure disguised as play.** An ordered GM procedure is real
  and ordered — use `## Step N:` and say plainly that it happens before the session.
  If the same procedure can *also* be performed in-world later (a fortune-teller
  reading for the players), say so and mark which text is player-facing in which
  case. They are two different things sharing one description.
- **Reference material implying presence.** A section describing an NPC's
  personality does not put that NPC in the room. See §10.
- **Chapter framing promoted to read-aloud.** An epigraph, a cover quotation, or a
  scene-setting paragraph addressed to the GM is category A, not G. Only convert
  text to `### Narrative` when the source intends or supports reading it aloud.
  When in doubt, it is not read-aloud.
- **Invented dialogue.** If the source says an NPC *believes* something, record the
  belief. Do not manufacture a quotable line to make the prose fit a dialogue card.
  Quotation marks are reserved for speech the source actually supplies.
- **Branch alternatives run as a sequence.** Four alternative openings are a choice
  the GM makes once. They are not four events, and the selector itself is not an
  event either.

#### Categories A–E and H produce documents with no Events at all

That is normal and correct. A scene file whose every `##` is a `Step`, a
`Conditional Procedure`, or an `Optional Briefing` — or which has no `##` beyond
its cards — is a legitimate RendScroll document. Do not manufacture Events to make
a preparation page look like the others.

Record the classification in the scene matrix (next stage) as an explicit column so
the decision is auditable rather than implicit.

### Stage D — Make a scene matrix

Create a planning table before generating files. One row equals one future scene
file. Use columns similar to:

| Order | Filename stem | Scene title | Category | Entry condition | Playable events | Required facts/cards | Exits |
|---|---|---|---|---|---|---|---|
| 1 | `001_arrival` | Arrival at Blackwater | F | Campaign start | Gate, witness, clue | Narrative, NPC, Object, checks | `002_bridge`, `003_marsh` |
| 2 | `000_prep` | Before You Begin | A/E | — | none | STD, Step 1–3, lore links | `001_arrival` |

The `Category` column is the Stage C classification. A row whose category is not
`F` must not have `## Event` headings.

Split into a new scene file when one or more are true:

- the location or time changes substantially;
- the GM would naturally turn to a new page;
- the players make a route choice that changes the next content;
- a major encounter or social sequence deserves its own table reference;
- the current file would become difficult to scan during play.

Do not split merely because the source starts a new paragraph. Conversely, do not
hide a real branch inside prose when it needs a navigable transition.

### Stage E — Extract reusable material

Before writing scene instances:

- put each reusable base item in `items/<Name>.md`;
- put each reusable enemy in `enemies/<Name>.md`;
- group campaign-wide background into `lore/<Page>.md` pages;
- collect portable images under `images/` and audio under `audio/`;
- give library files stable, unique names because references resolve by filename
  stem, case-insensitively.

### Stage F — Write scenes in play order

For every scene-matrix row:

1. Write the `#` scene title.
2. Add a `### Manifest` overview.
3. Add `##` events in the order the GM is likely to run them.
4. Begin each event with `### Narrative` when there is player-facing setup.
5. Place every NPC, object, check, combat, item, ability, contingency, and
   transition immediately where it becomes relevant.
6. End routes with explicit transitions when another scene file follows.

### Stage G — Perform a closed-world validation

Assume the generated folder is the only campaign content the recipient has. Check
all filenames, transitions, library references, lore links, and local assets
against that folder. Do not assume a global item, enemy, image, or audio library
will exist on the recipient's machine.

## 3. Importable campaign package

RendScroll imports a `.zip` containing exactly one top-level campaign folder.
That folder must contain a `scenes/` directory. Include at least one scene file.

Canonical layout:

```text
Blackwater Campaign/
├── campaign.json
├── scenes/
│   ├── 001_arrival.md
│   ├── 002_bridge.md
│   └── 003_marsh.md
├── lore/
│   ├── Blackwater.md
│   └── Old Gods.md
├── items/
│   └── Lantern of Still Rain.md
├── enemies/
│   └── Mire Scout.md
├── images/
│   ├── orren-vale.webp
│   └── maps/
│       └── blackwater-crossing.jpg
└── audio/
    └── marsh-night.ogg
```

Do not zip several sibling campaign folders together. The ZIP root must not be
`content/` or `campaigns/`; it must be the campaign folder itself.

### `campaign.json`

Include this file for deterministic naming:

```json
{
  "name": "Blackwater Campaign",
  "label": "Blackwater Campaign",
  "created": "2026-08-08T00:00:00Z",
  "schema": 1
}
```

- `name` is the campaign identifier/folder name.
- `label` is the human-facing name.
- `schema` must be `1`.
- `created` is an ISO-8601 UTC timestamp. It is useful but not semantically
  important to scene rendering.
- Campaign and library names must be non-empty, must not be `.` or `..`, and
  must not contain `/`, `\`, or a NUL character. Keep them at 120 characters or
  fewer.

If `campaign.json` is absent, RendScroll can synthesize one during import, but a
converter should include it.

### Optional files to omit by default

- `graph.json` is optional. Transition cards already define locked progression
  edges, and RendScroll can create/save the visual graph later.
- `.sys/` contains local runtime/editor state and should not be generated or
  distributed.
- renderer options are global to the installation and do not belong in a
  campaign package.

## 4. Scene filenames and ordering

Scene files live directly in `scenes/` and must end in `.md`.

Use a stable numeric prefix:

```text
001_arrival.md
002_bridge.md
003_marsh.md
010_finale.md
```

RendScroll sorts numerically by the leading integer, then by filename. Files with
no numeric prefix appear after numbered files. Use unique numbers and consistent
zero-padding for human readability.

**The number is displayed, not just a sort key.** The sidebar renders it as each
entry's visible index (`content: attr(data-nav-index)` in `styles/base.css`), so a
GM reading 1, 2, 10, 11 sees a list that appears to be missing scenes 3 through 9.

Number the scenes **contiguously from 001**, and renumber whenever the set changes.
Deleting a scene, or promoting one to a lore page, leaves a hole that looks like
lost content — close it. Do not reserve number bands for "sections"; express
grouping through titles and transitions instead, which is where a GM will actually
look for it.

Renumbering is a three-part edit, and all three must happen together:

1. rename the file;
2. update every `Scene:` value that targets the old stem;
3. update any conversion report, manifest, or checklist that cites the stem.

Verify afterwards that every `Scene:` still resolves. A stale target is a dead
Continue button, and RendScroll will not warn you at import time.

The sidebar label comes from the filename text after the numeric prefix. If the
filename is only a number such as `1.md`, RendScroll uses the first `#` title.

Transition targets use the complete filename stem:

```md
Scene: 003_marsh
```

The `.md` suffix is allowed but should be omitted consistently. Matching is
case-insensitive and exact after removing `.md`.

## 5. The structural parser model

RendScroll is line-oriented. These rules are load-bearing.

### Safe scene hierarchy

```md
# One scene title

### Manifest
Duration: 30 min
Summary: One sentence.

## Event 1: Arrival

### Narrative
Text:
> Player-facing text.

### NPC: A Person
...

## Event 2: The Choice
...
```

- The first `#` heading is the scene title and appears full-width.
- Content before the first `##` belongs to the full-width header band. Put the
  manifest there. `Side: R` has no useful two-column effect in this band.
- Each ordinary `##` begins a new event row. Event content defaults to the left
  column; right-side cards go to the event's right column.
- A later `#` heading creates a full-width section until the next `##`. Avoid this
  unless that layout is deliberate.
- `## Object: ...` and `## POI: ...` are Object cards, not event headings. Use
  `### Object:` inside an ordinary event to avoid ambiguity.
- Every heading of any level and every horizontal rule (`---`, `***`, or `___`)
  ends the current card. Never put headings or horizontal rules inside a card.
- Avoid `####`, `#####`, and `######` in scene files. They terminate the card
  above and become new section boundaries.
- A supported card begins at its `###` heading and ends at the next heading,
  horizontal rule, or end of file.
- Always include a space after heading markers: `### NPC: Name`, not
  `###NPC: Name`.

### Code-fence warning

The structural parser examines lines without first excluding fenced code blocks.
A heading, horizontal rule, or directive-looking line inside a code fence can
still affect scene structure. Avoid fenced code in generated scene files. Short
GM-only notes should use inline code:

```md
`Orren is lying about when the wagon arrived.`
```

### Plain Markdown

Inside ordinary card bodies, standard Markdown such as paragraphs, `-` bullets,
ordered lists, emphasis, bold text, inline code, and blockquotes is allowed.
Specialized cards impose additional formats described below.

For source-compatible output:

- use `-` for bullets;
- keep blockquote text complete rather than writing instructions like
  `> Describe the room`;
- keep structural labels on their own lines;
- separate cards with a blank line;
- do not use Markdown tables inside specialized field blocks unless the card is
  documented as ordinary prose.

## 6. Events, read-aloud text, and GM information

An event is a playable beat, not necessarily a whole location. It should contain
all information needed when that beat occurs.

`##` headings are not a generic outline device. An `##` in a scene file reads as
"and then this happens." Use `## Event N:` only for Stage C category F. For the
other categories, keep the `##` label honest about what it is — `## Step 1:`,
`## Optional Briefing:`, `## Conditional Procedure:`, `## Choose One` — or use no
`##` at all and let the file be a flat page of cards. A preparation document with
zero `##` headings is valid.

Canonical event opening:

```md
## Event 1: Gatehouse Questions
Collapsible: T

### Narrative
Text:
> Rain taps against the gatehouse roof while a narrow road disappears into the marsh. A clerk sits behind a barred window, his ink-stained fingers resting on an open toll ledger.

### STD: GM Notes
- The ledger contains the missing guards' names.
- Orren is nervous but not hostile.
`This event establishes the witness and the first lead.`
```

The `### STD:` heading ends the Narrative card and gives the following GM notes
their own bounded card. Plain content may also appear directly after an `##`
event and before its first card. Once a card begins, however, every following
line remains in that card until another heading, horizontal rule, or end of file.
Do not assume a blank line ends a card.

Standalone blockquotes outside cards may still render, but current RendScroll
diagnostics treat them as legacy narrative. Generate `### Narrative` cards
instead.

### Event-heading collapse

Place one of these directly under an `#` or `##` heading and outside every card:

```md
Collapsible: T
Collapsible: F
```

The alternate spelling `Collapsable:` is also accepted. `T` opts in and `F` opts
out. Event headings are normally collapsible; the first page-title `#` is not
unless explicitly opted in. Do not confuse this with a card's `Closed:`
directive.

## 7. Universal card directives

Directives must be standalone, non-empty `Label: value` lines inside a card. The
canonical spellings below are recommended.

| Directive | Canonical value | Effect |
|---|---|---|
| `Side:` | `R` | Move the card to the right event column. Omit for left. |
| `Image:` | asset reference | Card portrait or Picture image on card types that support it. |
| `BG:` | asset reference | Watermark on NPC and Object cards. |
| `Closed:` | `T` or `F` | Pin the initial state of a collapsible card. |
| `Text Size:` | number `8`–`32` | Scale supported card prose in pixels. |
| `Size:` | number `5`–`100` | Picture width as a percentage of its column. |
| `File:` | audio reference | Audio card media file. |
| `Combine:` | `T` | Dock an Item or Ability to a valid card immediately above. |
| `Connect:` | `T` | Alias of `Combine:`. Prefer `Combine:`. |
| `LoreRef:` | `Page/Entry` | Attach a clickable lore chip to a supported card. Repeatable. |

Directive labels are case-insensitive. Spaces, `_`, and `-` in directive names
normalize to the same name, but always emit the canonical spellings above.

Important value behavior:

- `Side: R` and `Side: Right` are right; use `R` for deterministic output.
- `Combine:`/`Connect:` truthy values are `T`, `true`, `yes`, and `1`; use `T`.
- `Closed:` should use only `T` or `F`.
- `Text Size:` accepts integers or decimals from 8 through 32 inclusive.
- `Size:` accepts integers or decimals from 5 through 100 inclusive.
- A missing value such as `Image:` is malformed. Never emit an empty directive;
  omit the line instead.
- Do not repeat a directive in one card except `LoreRef:`. The first value of an
  ordinary directive wins. `LoreRef:` deliberately allows one line per target.
- Reserved directive labels are removed from prose when valid. Do not use
  `Image:`, `Size:`, `File:`, and the other directive names as ordinary numeric
  metadata in an unrelated card.

### Directive support by card

| Card | Useful directives |
|---|---|
| Manifest | none normally; keep it full-width |
| Narrative | `Side`, `Text Size` |
| NPC | `Image`, `BG`, `Side`, `Text Size`, `Closed`, `LoreRef` |
| Skill Checks | `Side`, `Text Size`, `Closed` |
| Object / POI | `Image`, `BG`, `Side`, `Text Size`, `Closed`, `LoreRef` |
| Combat | `Image`, `Side`, `Text Size`, `Closed`, `LoreRef` |
| Item | `Image`, `Side`, `Text Size`, `Combine`, `Closed`, `LoreRef` |
| Ability | `Image`, `Side`, `Text Size`, `Combine`, `Closed`, `LoreRef` |
| Unexpected | `Image`, `Side`, `Text Size`, `Closed` |
| STD | `Image`, `Side`, `Text Size` |
| Picture | `Image`, `Size`, `Side` |
| Audio | `File`, `Side` |
| Transition | `Side` |

`Closed:` has a visible collapse-toggle effect on NPC, Skill Checks, Object,
Combat, Item, Ability, and Unexpected cards. Do not rely on it for Manifest,
Narrative, STD, Picture, Audio, or Transition cards.

### Card-attached lore references

NPC, Object/POI, Combat, Item, Ability, and SourceItem cards may attach lore chips:

```md
LoreRef: The Sunken Choir/The Drowned God
LoreRef: Blackwater/The Flood
```

- Use one `LoreRef:` line per page or entry.
- The canonical value is `Page` or `Page/Entry`. A leading `lore:` is tolerated
  but should be omitted in this directive.
- The target uses the same case-insensitive page/entry resolution as a prose
  `[link=lore:...]` link.
- The chip remains visible in the card head when the card is collapsed.
- A missing target remains visible as a broken chip instead of being silently
  discarded.
- Attach only directly relevant lore. Do not turn the card head into a complete
  index of everything tangentially related to the entity.

### Docking rules

Only Item and Ability cards dock:

- a combined Item may dock under an Object;
- another combined Item may continue under a combined Item;
- a combined Ability may dock under an Object or Item;
- another combined Ability may continue under a combined Ability.

The combined card must be the next rendered node. A paragraph, list, heading,
horizontal rule, event boundary, or unrelated card between host and child breaks
the connection. A docked card follows its host's actual column even if its own
`Side:` says otherwise.

## 8. Scene Manifest

Use exactly `### Manifest`, with no colon and no title. Put it after the scene
title and before the first event.

```md
### Manifest
Duration: 30 min
Summary: The party questions a gate clerk, follows the missing wagon, and chooses between the bridge and marsh.
Goals:
- Establish the missing caravan mystery.
- Reveal two viable routes.
- Put the blue wax seal in the party's hands.
Key NPCs:
- Orren Vale
Rewards:
- Blue wax seal
- Route to Blackwater
```

Supported fields, in canonical order:

1. `Duration: value`
2. `Summary: one-line value`
3. `Goals:` followed by bullets
4. `Key NPCs:` followed by bullets
5. `Rewards:` followed by bullets

Omit empty fields. Do not write a list on the same line as its label. Use a short
summary for GM orientation, not read-aloud narration.

`Key NPCs:` means **physically present in this scene**, not "mentioned here" and
not "relevant to this material." Listing an absent NPC is the presence trap of
Stage C leaking into metadata: it tells the GM someone is in the room who is not,
and on a preparation page it can even leak a secret the source says to withhold.
If nobody is present, omit the field. The same applies to `Rewards:` — list what
the party can actually walk away with here.

## 9. Narrative card

Use exactly `### Narrative`, with no colon.

```md
### Narrative
Side: R
Text Size: 18
Text:
> The stone door opens with a slow scrape.
>
> Inside, a cold blue flame burns without smoke.
```

Rules:

- `Text:` must be a bare label on its own line.
- Only blockquotes after `Text:` become the narrative content.
- Put every player-facing sentence in complete form.
- Content before `Text:` or non-blockquote content after it is not part of the
  rendered narrative and should not be generated.

## 10. NPC card

Use `### NPC: Name`.

```md
### NPC: Orren Vale
Image: orren-vale.webp
BG: gatehouse-watermark.png
Personality:
- Polite under pressure.
- Counts every coin twice.
Race: Human
Age: 52
Occupation: Gatehouse Clerk
Alignment: Lawful Neutral
HP: 9
AC: 10

First Greeting:
- "Who are you?"
> "If you came for the west road, write your names here and do not linger by the old bridge."

Missing Caravan:
- "What happened to the last caravan?"
> "They paid at dusk. Their horses came back before dawn, but the wagon was gone."

Checks:
- Insight:
> 12: Orren is more afraid of the bridge than of the missing caravan.
> 16: He saw a silver lantern hanging below the bridge.
```

Supported identity fields:

- `Personality:` followed by bullets or prose;
- `Race:`, `Age:`, `Occupation:`, `Alignment:`, `HP:`, and `AC:` as scalar rows;
- `Image:` for a portrait and `BG:` for a watermark.

Dialogue topic rules:

- A plain label such as `Missing Caravan:` opens a dialogue subcard.
- Keep a topic label to **40 characters or fewer, including the colon**. This is a
  hard renderer limit, and exceeding it fails silently: a 41-character label is not
  reported as an error, it simply stops being a topic and drops into the body as
  loose prose. Count the characters. `If the Characters Deliver the Warning:` is
  38 and works; adding one more word does not.
- Use letters, digits, spaces, and `_`; simple ASCII labels are safest. Apostrophes
  and other punctuation disqualify the line as a topic, so rephrase rather than
  dropping the apostrophe from a possessive.
- Do not use `####` headings for dialogue. Every heading ends the NPC card.
- Put sample player questions in bullets and complete NPC answers in
  blockquotes.
- `Checks:` may appear once or more. Put it last unless a following topic label
  is a simple ASCII `Topic:` line that clearly closes the check block.

Known labels such as `First Dialogue:`, `If Asked:`, `What They Know:`, and
`What They Don't Know:` render as field labels rather than topic subcards. For
predictable dialogue panels, prefer descriptive custom topics such as
`First Greeting:` and `Missing Caravan:`.

## 11. Skill Checks card and embedded checks

Use exactly `### Skill Checks` for event-wide checks. NPC, Object, and Combat
cards may instead contain an embedded `Checks:` block with the same inner
grammar.

```md
### Skill Checks
General:
- Passive Perception:
> 10: The water is moving against the wind.
> 15: A faint voice repeats the same name beneath the stones.
- Investigation:
> F: The character still finds the wagon trail, but misses the hidden hook.
> 12: Scratches on the rail match wagon-wheel iron.
> 16: The scratches stop at the center of the bridge.
- Speak with Dead:
> 1: "Lantern."
> 2: "Below."
> 3: "Do not answer."
```

Grammar:

- An unbulleted line ending in `:` is a category such as `General:`.
- `- Skill Name:` begins a check.
- `> DC: result` is a numeric outcome.
- `> F: result` is a styled failure outcome.
- `> result` is a plain outcome without a badge.
- Put numeric DC outcomes in ascending order. Out-of-order DCs still render but
  produce a warning.
- Failure must change cost, clarity, time, position, or consequence without
  accidentally removing every route forward unless the source campaign truly
  intends a hard stop.

Standard recognized checks:

- Skills: Athletics, Acrobatics, Sleight of Hand, Lockpicking, Stealth, Arcana,
  History, Investigation, Nature, Religion, Animal Handling, Insight, Medicine,
  Perception, Survival, Deception, Intimidation, Performance, Persuasion.
- Abilities: STR/Strength, DEX/Dexterity, CON/Constitution,
  INT/Intelligence, WIS/Wisdom, CHA/Charisma.
- Saves: `STR Save`, `Strength Save`, or `Strength Saving Throw`, and the same
  forms for the other five abilities.
- Passive checks: for example `Passive Perception`.
- Information magic: `SWD`/`Speak with Dead`, `DT`/`Detect Thought` or
  `Detect Thoughts`, `SWA`/`Speak with Animal` or `Speak with Animals`, and
  `Detect Magic`.

`Speak with Dead` is treated as numbered answers rather than normal DCs. Unknown
check names still render as text but diagnostics report them as non-standard. Map
source-system checks to recognized names only when the mapping is justified; do
not falsify the source mechanics merely to suppress a warning.

## 12. Object / Point of Interest card

Use `### Object: Name` or `### POI: Name`. Prefer `Object` for interactable things
and `POI` for a location feature.

```md
### Object: Broken Toll Gate
Image: broken-gate.jpg
BG: timber-mark.png
> The gate arm has been split by a single heavy impact. Iron nails jut from the wood like crooked teeth.

Checks:
- Investigation:
> 10: The gate was broken from the road side.
> 15: A wagon stopped here long enough to unload something heavy.
- Survival:
> 12: Four people walked toward the marsh.

Loot:
- Blue wax seal
- Bent toll spike
```

Rules:

- Description Markdown comes first.
- `Checks:` uses the shared check grammar.
- `Loot:` switches all following body content into the loot panel; put it last.
- `Image:` is a portrait; `BG:` is a watermark.
- Always use the H3 form inside an event. An H2 Object/POI is parsed as a card
  and therefore does not open a normal event.

Use Object cards for doors, clues, mechanisms, corpses, containers, shrines,
rooms, hazards, and scenery players can inspect or manipulate.

## 13. Combat card

Use `### Combat: Encounter Name`.

```md
### Combat: Tollhouse Ambush
Image: mire-scout.webp
> Two shapes rise from the reeds, water streaming from patched leather armor.

Enemies:
- Mire Scout | Medium Humanoid | AC 13 | HP 18 | Init +2 | Speed 30 ft | x2
  - Attack: Rusted Spear | +4 | 1d6+2 Piercing
  - Attack: Mud Sling | +3 | 1d4 Bludgeoning
  - Weak Save: Wisdom
  - Strong Save: Dexterity
  - Resist: Cold
  - Immune: None
  - Trait: Marsh Step ignores shallow-water difficult terrain.
  - Tactics: One scout pins the front line while the other circles toward the lantern.

Environment:
- Deep mud is difficult terrain.
- The rotten railing collapses under 100 pounds.

Checks:
- Perception:
> 13: Notice the second scout before its first turn.
```

### Enemy header grammar

Each inline enemy begins with an unindented top-level bullet:

```md
- Name | Subtitle | AC 13 | HP 18 | Init +2 | Speed 30 ft | x2
```

- `Name` is required for useful output.
- `Subtitle` is optional creature type/flavor.
- `AC`, `HP`, `Init`, and `Speed` are optional but should be included when the
  source provides them.
- `Init` is a modifier such as `+2`, not `1d20+2`.
- `xN` is optional and sets the count. Use a positive integer.
- Use a simple integer HP when the live combat runner must track it reliably.

Indented sub-bullets belong to the enemy above them:

```md
  - Attack: Attack Name | to-hit | damage
  - Weak Save: value
  - Strong Save: value
  - Resist: value
  - Immune: value
  - Trait: value
  - Tactics: value
```

Repeat `Attack:`, `Trait:`, or `Tactics:` as needed. Unknown indented labels are
preserved as traits. For best damage rendering use dice with d4, d6, d8, d10,
d12, or d20, for example `2d6+1 Slashing + 1d4 Fire`.

### Combat sections

Any bare ASCII letters-and-spaces label ending in `:` opens a titled combat
section, for example `Environment:`, `Tactics:`, or `Reinforcements:`. `Enemies:`
is special and consumes enemy bullets until the next such section or `Checks:`.

Use the modern `Enemies:` structure when the fight should support the live combat
runner. Old prose such as `Stats: AC 13, HP 8` may display, but it does not provide
structured enemy tracking.

### Referencing a reusable enemy

Inside `Enemies:`, replace an inline record with:

```md
- [enemy=Mire Scout] x3
```

The name resolves case-insensitively against `enemies/Mire Scout.md`. The optional
count overrides the library record's count.

## 14. Item card

Use `### Item: Name` for an item instance in a scene.

```md
### Item: Lantern of Still Rain
Type: Wondrous Item
Damage: 1d4 Radiant
Rarity: 2
Image: lantern.webp
> This brass lantern burns with a pale blue flame that does not flicker in wind or rain.

Properties:
- Rain within 10 feet falls silently while the lantern is lit.
- Once per long rest, invisible wet footprints become visible for 10 minutes.
```

Fields:

- `Type:` may be a standard type or custom text.
- `Damage:` uses the shared damage expression when applicable.
- `Rarity:` must be `1` Common, `2` Rare, or `3` Epic. Any other value still
  prints, but loses its rarity badge styling — so a source "Legendary" written
  literally renders with *less* emphasis than a common item. Map the source tier
  onto `1`/`2`/`3` and preserve the original wording as a `Properties:` bullet.
- Any other non-empty `Label: value` line becomes an additional metadata row,
  unless it is a reserved universal directive.
- Description lines begin with `>`.
- `Properties:` is a bare label followed by bullets.
- `Image:` adds a portrait.

Standard item types include armor, shields, standard simple/martial weapons,
Potion, Scroll, Wand, Rod, Staff, Ring, Wondrous Item, Ammunition,
Adventuring Gear, and Tool. Unknown item types still render as neutral custom
text.

### Item library inheritance

A scene item may inherit from `items/<Name>.md`:

```md
### Item: Damaged Lantern
SourceItem: Lantern of Still Rain
Rarity: -
Properties:
- The reveal-footprints property is spent until the next dawn.
```

Resolution rules:

- `SourceItem:` matches the library filename stem case-insensitively.
- A non-empty scene field overrides the source field.
- An omitted field inherits the source value.
- `-` clears an inherited scalar/metadata value.
- A single `-` property entry clears inherited properties.
- `Side`, `Text Size`, `Combine`/`Connect`, and `Closed` belong to the scene
  instance and do not inherit.
- A scene Item's `LoreRef:` lines are also explicit attachments on that instance;
  do not assume they inherit from a SourceItem.
- Avoid chains in which one SourceItem inherits another. Generate one complete
  base definition and shallow scene instances.

## 15. Ability card

Supported headings are:

- `### Spell: Name`
- `### Skill: Name`
- `### Passive: Name`
- `### Effect: Name`

Example:

```md
### Spell: Trace the Drowned Road
Image: lantern-flame.webp
Type: Divination
Cost: 1 Action
Range: Self
Cooldown: 1 Long Rest
Rarity: 2
> The flame stretches into a thread of light and marks the path most recently taken by a soaked creature or wagon.

Properties:
- The path remains visible to the caster for 10 minutes.
- The path ends early if it crosses running water.

Lore:
> Ferrymen once used this magic to guide mourners through flooded grave roads.
```

Rules:

- The heading keyword becomes the visible ability kind.
- `Type`, `Cost`, `Range`, `Cooldown`, and `Rarity` are canonical metadata.
- Any other non-reserved `Label: value` before `Lore:` also becomes metadata.
- Description lines use `>`.
- `Properties:` is followed by bullets.
- `Lore:` switches the rest of the card into the lore panel. It must be last.
- `Image:` is supported.
- Use `Combine: T` immediately after the granted item/object when the ability
  should dock visually beneath it.

## 16. Unexpected card

Use `### Unexpected: Title` for contingencies, skipped content, and fail-forward
logic.

```md
### Unexpected: Bridge Complications
- If the party calls to the voices: the water answers with one true memory and one false direction.
- If the party crosses without stopping: they arrive safely, but hear their names beneath the bridge that night.
- If the party destroys the bridge: the hidden hook becomes visible for one hour.

Failed checks:
- Investigation: the wagon trail remains visible, but the hidden hook is missed.
- Arcana: the party knows the bridge is magical, but not how it chooses a voice.
```

The body is ordinary Markdown. Labels such as `Failed checks:` have no special
parser behavior here; they are visual prose structure. Keep contingencies
specific: trigger, consequence, and surviving route.

## 17. Standard text card

Use `### STD: Optional Title` for bounded information that needs no specialized
schema.

```md
### STD: Evidence Summary
> By the time the party leaves, three facts are clear: the wagon stopped willingly, the bridge was used after dark, and someone carried a heavy object into the marsh.

Use this beat if the table needs a recap before choosing a route.
```

The body is ordinary Markdown. STD is appropriate for recaps, travel beats,
warnings, timers, scene rules, and GM instructions.

Do not generate `### Echo ...` headings. Echo is a legacy classification-only
heading and does not create a real card. For a vision or memory use:

```md
### STD: Echo — Bridge Memory
> A wagon wheel turns in moonlit mud. Someone below the bridge whispers a name, and every horse stops breathing at once.
`The party should understand that the bridge witnessed the abduction, not who caused it.`
```

## 18. Picture card

Use `### Picture: Optional Caption`.

```md
### Picture: Map of Blackwater Crossing
Image: /images/maps/blackwater-crossing.jpg
Size: 85
Side: R
```

- `Image:` is required for a useful picture card.
- `Size:` is 5–100 percent and defaults to 100.
- Picture shows the whole image with contain-style fitting, unlike portrait
  images that may be cover-cropped.
- The caption becomes alt text and a visible caption.
- Remaining prose can render, but a converter should keep this card focused on
  the image.

## 19. Audio card

Use `### Audio: Optional Caption`.

```md
### Audio: Marsh at Night
File: marsh-night.ogg
Side: R
```

- `File:` is required for a useful audio card.
- It renders a native audio player.
- A bare name without an extension defaults to `.mp3` under `audio/`.
- Remaining prose can render below the player, but keep it brief.

## 20. Transition card

Use `### Transition: Choice Label`.

```md
### Transition: Follow the Wagon Tracks
Scene: 003_marsh
> Use this when the party leaves the road and follows the tracks into the reeds.
```

Rules:

- `Scene:` is required for a working Continue button.
- Its value is the exact target filename stem, case-insensitively.
- The rest of the body is GM-facing Markdown explaining when the transition is
  valid or what carries forward.
- Each Transition also creates a locked directed edge in RendScroll's scene map.
- Put multiple Transition cards at a branch point, one per destination.
- Do not create a transition to the current file unless the source campaign
  intentionally loops.
- Do not use prose-only "go to scene" instructions when a resolvable Transition
  can represent the branch.

### A Transition asserts chronology — never point one at a lookup

A Transition is not a cross-reference. It renders a Continue button and locks a
directed edge in the scene map, so it states: *after this, that happens next.*
Two consequences follow.

- **Never transition into a reference document.** If several branches all point at
  one document that merely lists what each branch's outcome was, you have rebuilt
  the very convergence you avoided inside the scenes, and a GM who ran one branch
  is shown the outcomes of branches they never ran. Put each branch's outcome in
  that branch's own scene. Prose disclaiming the convergence does not cancel the
  edge — delete the edge.
- **Convergence must be real.** Two routes may target the same later stem when the
  source genuinely reunites them at a scene that is played. They must not target a
  shared summary page.

When a chapter or route simply ends, it ends. A terminal scene needs no Transition;
close it with an `### STD:` note naming the destination in the wider campaign.

## 21. SourceItem library files

Each reusable item is one Markdown file in `items/`. The filename stem is the
reference key and should match the heading title.

`items/Lantern of Still Rain.md`:

```md
### SourceItem: Lantern of Still Rain
Type: Wondrous Item
Rarity: 2
Image: lantern.webp
> This brass lantern burns with a pale blue flame that does not flicker in wind or rain.

Properties:
- Rain within 10 feet falls silently while the lantern is lit.
- Once per long rest, invisible wet footprints become visible for 10 minutes.
```

SourceItem files use the same item fields but should not contain scene-only
`Side`, `Text Size`, `Combine`, `Connect`, or `Closed` directives. Keep one card
per file. Do not add an H1 page title. A SourceItem may contain repeatable
`LoreRef: Page/Entry` attachments when the reference is intrinsic to the base
item.

## 22. SourceEnemy library files

Each reusable enemy is one Markdown file in `enemies/`. The filename stem is the
reference key and should match both the SourceEnemy title and record name.

`enemies/Mire Scout.md`:

```md
### SourceEnemy: Mire Scout
- Mire Scout | Medium Humanoid | AC 13 | HP 18 | Init +2 | Speed 30 ft
  - Attack: Rusted Spear | +4 | 1d6+2 Piercing
  - Weak Save: Wisdom
  - Strong Save: Dexterity
  - Resist: Cold
  - Trait: Marsh Step ignores shallow-water difficult terrain.
  - Tactics: Circle toward isolated targets.
```

Rules:

- Use exactly one enemy record per SourceEnemy file.
- Do not add an `Enemies:` label in a SourceEnemy file.
- Do not add scene-only directives.
- Reference it only as an enemy row inside a Combat card:
  `- [enemy=Mire Scout] x2`.

## 23. Lore pages

Lore is campaign-scoped reference prose that no single scene owns. It lives in
`lore/`; there is no assumed global lore library.

Canonical file:

```md
# Lore: The Sunken Choir
Keywords: ancient history, lost city

## Entry: The Drowned God
Keywords: deity, Ancient God

Worshipped beneath the tide-locked gate for nine centuries.

> Its name is not spoken above water.

## Entry: The Fall
Keywords: collapse

The choir sank in a single night. No one agrees why.
```

Contract:

- The only H1 is `# Lore: Page Name`.
- Every entry begins `## Entry: Entry Name`.
- Page and entry names are required and may not contain `/` or `\`.
- Entry names must be unique within a page, ignoring case and edge whitespace.
- `Keywords:` is optional and comma-separated. Put it immediately below the page
  or entry heading.
- Keyword comparison lowercases and removes all whitespace. Therefore
  `Ancient God`, `ancient god`, and `AncientGod` are duplicates. Keep the first
  preferred spelling.
- Keyword matching is exact after that normalization, never prefix-based.
- Page keywords do not propagate to entries.
- Page-level prose is forbidden; all prose belongs inside an entry.
- Entry bodies are ordinary Markdown. Do not put another H1 or arbitrary H2 in
  an entry. Use H3 or lower only if a body subdivision is truly necessary.
- Keep the filename stem equal to the page name. This is not merely cosmetic:
  links resolve the page component against the library filename.
- Write lore as in-world reference prose. It must not contain notes about the
  conversion itself — "in this package," "the converter chose," "see scene 014."
  Those belong in the conversion report or in an `### STD:` GM note in a scene.
- Use LF line endings and keep the file canonical. A lore page that does not
  round-trip through the lore editor's serializer will be silently rewritten the
  first time someone saves it.

### Lookup pages

A category-H page holds many mutually exclusive results. Give it one entry that
explains how to use the lookup, then list the results as `###`/`####` subdivisions
inside that entry. Optimize for a GM who reads exactly one row: keep each result to
its trigger, its supplied text, and its outcome. Do not decorate every row with
art, and do not group results under invented headings the source does not have —
alphabetical or suit order is enough.

### Lore links

```md
The bridge predates the [link=lore:The Sunken Choir]drowning[/link].
She swears by [link=lore:The Sunken Choir/The Drowned God]the old name[/link].
```

Page and entry matching is case-insensitive. A page rename does not automatically
rewrite links; the converter must update every affected link.

## 24. Inline references and formatting

### Item/enemy/on-page links

```md
The seal bears the mark of the [link=Lantern of Still Rain]silent lantern[/link].
```

`[link=Name]visible text[/link]` resolves case-insensitively in this order of
purpose:

- a card title on the current scene can be revealed/scrolled to;
- otherwise a matching reusable item or enemy can be previewed.

Lore must use the typed `lore:` address described above. Avoid giving an item and
enemy the same filename stem when either will be reached by a bare link, because
an untyped name is ambiguous to a human even if the application chooses one.

Do not use standalone `[item=Name]` as visible scene content. It is not a rendered
item card. Use an `### Item:` with `SourceItem:`. Use `[enemy=Name]` only in the
structured `Enemies:` block of a Combat card.

### Inline text size

```md
This word is [size=24]important[/size].
```

The size must be from 8 through 32 inclusive. Normal Markdown may appear inside
the tag. Always close `[size]` and `[link]` tags.

## 25. Images and audio

### Ship the file or omit the directive

**Write an asset reference only when the binary is already in the package.** This
is the single most common way a conversion arrives broken: the converter plans an
illustration programme, emits the directives, and ships no files. The result is not
a package "awaiting art" — it is a package where every card points at a 404.

If you cannot supply an image, omit the directive and put the information in words.
A `### Picture:` card with no `Image:` is an empty card; delete it. A handout the
players are meant to see should cite the published handout in prose ("show the
Appendix F letter") rather than reference a file you do not have.

### Keep the image budget small

Images are decoration on top of a text renderer, not content. Before adding one,
ask what it does for the GM that the card's words do not.

- **Do not illustrate every row of a lookup table.** One image per possible result
  in a table the GM consults once is pure weight — it makes the one row they need
  harder to find.
- **Do not portrait every walk-on NPC.** Reserve portraits for recurring or
  centrally important characters. `Personality:` bullets carry the table
  information.
- **Do prioritize genuine player-facing handouts** — letters, maps, crests, symbols
  the source explicitly says to show the players — and GM-facing diagrams that are
  awkward to describe in words.

A campaign with six well-chosen images is more usable than one with seventy.

### Portable asset strategy

For an importable package, put assets inside the campaign folder and reference
them through the shared `/images/` or `/audio/` URL space. RendScroll resolves
campaign-local assets before global assets.

Image formats recognized by the asset tools:

```text
.png .jpg .jpeg .gif .webp .bmp .svg
```

Audio formats recognized by the asset tools:

```text
.mp3 .ogg .wav .m4a .flac
```

### Image references

- `Image: orren` resolves as `/images/orren.png`.
- `Image: orren.webp` preserves the extension.
- `Image: /images/portraits/orren.webp` addresses a nested asset.
- `BG:` follows the same rules.
- Bare campaign-local assets shadow global assets with the same relative name.
- Use exact filename case even though the development machine may be
  case-insensitive.

### Audio references

- `File: ambience` resolves as `/audio/ambience.mp3`.
- `File: ambience.ogg` preserves the extension.
- `File: /audio/ambience/marsh.ogg` addresses a nested asset.

HTTP(S) URLs can render but are not portable and are skipped by package asset
collection. Do not use remote assets in a self-contained conversion unless the
user explicitly asks for them.

Never emit an empty `Image:`, `BG:`, or `File:` line. If the source does not
provide an asset, omit the directive. Do not invent a filename for an asset that
is not included.

## 26. Content adaptation rules

### Preserve source fidelity

- Keep names, motives, relationships, clues, and sequence faithful.
- Preserve exact boxed text where permitted; otherwise make the minimum edits
  needed to turn incomplete notes into complete read-aloud text.
- Preserve supplied game statistics and DCs.
- If the source omits an optional field, omit it rather than fabricating it.
- If a missing mechanical value is essential to run the scene, flag the gap for
  the user instead of silently pretending it came from the source.

### Make scenes table-runnable

- Put immediate facts before deep background.
- Keep bullets atomic: one actionable fact per bullet.
- Put an NPC's knowledge with that NPC and an object's clues with that object.
- Put event-wide checks in Skill Checks, not in a distant appendix.
- Put missed-clue recovery and off-script behavior in Unexpected.
- Put full reusable definitions in libraries and only instance overrides in
  scenes.
- Put non-immediate history and cosmology in lore, then link it where relevant.

### Branches and fail-forward design

- Preserve all meaningful choices from the source.
- Give each destination its own Transition when it is a separate scene file.
- If two routes reconverge, both may target the same later stem.
- When a clue is mandatory, preserve at least one unconditional way to obtain
  it, or document the source's alternate route.
- Do not convert a failed check into a dead end unless the original campaign
  explicitly does so.
- Track state changes in GM prose or STD/Unexpected cards when RendScroll has no
  dedicated persistence mechanic for that state.

## 27. A complete modern scene example

`scenes/001_arrival.md`:

```md
# The Missing Wagon

### Manifest
Duration: 30 min
Summary: The party questions Orren, examines the broken gate, and chooses whether to follow the road or the marsh trail.
Goals:
- Establish the missing caravan.
- Reveal the bridge and marsh routes.
- Give the party the blue wax seal.
Key NPCs:
- Orren Vale
Rewards:
- Blue wax seal
- Lantern of Still Rain

## Event 1: Gatehouse Questions
Collapsible: T

### Narrative
Text:
> Rain taps against the gatehouse roof while a narrow road disappears into the marsh. A clerk sits behind a barred window, his ink-stained fingers resting on an open toll ledger.

### NPC: Orren Vale
Image: orren-vale.webp
Personality:
- Polite under pressure.
- Avoids naming anyone important unless pressed.
Race: Human
Age: 52
Occupation: Gatehouse Clerk
HP: 9
AC: 10
First Greeting:
- "Who are you?"
> "If you came for the west road, write your names here and do not linger by the old bridge."
Missing Caravan:
- "What happened?"
> "They paid at dusk. Their horses returned before dawn, but the wagon was gone."
Checks:
- Insight:
> 12: Orren is more frightened of the bridge than of the caravan's disappearance.
> 16: He saw a silver lantern hanging below the bridge.

## Event 2: Broken Toll Gate

### Narrative
Text:
> The road narrows between two leaning stone posts. A shattered wooden arm blocks half the path, and fresh mud has dried in deep wheel ruts.

### Object: Broken Toll Gate
> Iron nails jut from the split timber like crooked teeth.
Checks:
- Investigation:
> 10: The gate was broken from the road side.
> 15: The wagon stopped long enough to unload something heavy.
- Survival:
> 12: Four people walked toward the marsh.
Loot:
- Blue wax seal
- Bent toll spike

### Item: Lantern of Still Rain
SourceItem: Lantern of Still Rain
Combine: T

### Unexpected: Missed Clues
- If the party ignores the gate: Orren notices the blue wax and hands it to them before they leave.
- If every check fails: the wheel ruts still reveal the marsh route, but not how many people took it.

## Event 3: Route Choice

### STD: Available Routes
- The old road leads to the silent bridge.
- The wheel ruts leave the road and enter the marsh.

### Transition: Take the Old Road
Scene: 002_bridge
> Use when the party follows the road toward the silent bridge.

### Transition: Follow the Wagon Tracks
Scene: 003_marsh
Side: R
> Use when the party follows the wheel ruts into the marsh.
```

## 28. Final output protocol for an AI converter

When asked to perform a conversion, deliver all of the following:

1. A concise conversion summary: source scope, number of scene files, branches,
   libraries, lore pages, and assets.
2. The complete import-folder tree.
3. The full content of `campaign.json`.
4. The full content of every scene `.md` file, each clearly labeled by path.
5. The full content of every item, enemy, and lore `.md` file.
6. An asset manifest mapping each `Image:`, `BG:`, and `File:` value to the exact
   included path. If binary assets cannot be supplied, report them as blockers and
   remove their directives from the supposedly ready files.
7. A reference manifest listing every transition, SourceItem, enemy reference,
   bare link, prose lore link, and card `LoreRef` with its resolved target.
8. A short assumptions/ambiguities report outside the import folder.

If the environment can create files, create the folder and ZIP it. If it can only
return text, use one fenced block per file and never abbreviate a body.

Do not claim "import-ready" while any required file, reference target, or local
asset is missing.

## 29. Final validation checklist

### Package

- [ ] The ZIP has exactly one top-level campaign folder.
- [ ] The campaign folder contains `campaign.json` and a non-empty `scenes/`.
- [ ] All text files are UTF-8 Markdown/JSON.
- [ ] No generated `.sys/` runtime state is included.
- [ ] No external global content is required for a self-contained campaign.

### Classification

- [ ] Every source section carries an explicit Stage C category (A–H).
- [ ] Every `## Event` passes the test: the GM could point at it mid-session and
  say "this is what is happening right now at the table."
- [ ] No category A–E or H material appears as an Event.
- [ ] Preparation procedures use `## Step N:` and say they happen before play.
- [ ] Lookup tables are lore entries, not scenes and not events.
- [ ] Alternative branches are presented as a choice, not as a sequence.
- [ ] Every `### Narrative` reproduces text the source intends to be read aloud.
- [ ] Every quotation is speech the source actually supplies; none was invented to
  fit a card.
- [ ] No NPC card, `Key NPCs:` entry, or dialogue block implies presence where the
  source only supplies reference information.

### Scene structure

- [ ] Every scene has exactly one primary `#` title.
- [ ] The manifest is before the first `##`.
- [ ] Playable events use `##` and appear in run order.
- [ ] Player-facing event openings use `### Narrative` + `Text:` + `>`.
- [ ] Every `###` heading is one of the supported canonical card forms.
- [ ] No H4–H6 or horizontal rule appears inside a card.
- [ ] No code fence contains heading-, rule-, or directive-shaped lines.
- [ ] Every directive has one non-empty valid value and is not duplicated.
- [ ] Repeated directives are only `LoreRef:` lines, with one valid target each.
- [ ] `Text Size` is 8–32 and Picture `Size` is 5–100.
- [ ] Right-column cards occur after the first `##`.
- [ ] Every combined Item/Ability has an immediately adjacent valid host.

### Specialized cards

- [ ] Manifest list fields use bullets.
- [ ] NPC topics are plain short labels, not subheadings, and every one is 40
  characters or fewer including the colon.
- [ ] Check outcomes use `> DC: text`, `> F: text`, or plain `> text`.
- [ ] Numeric DCs are ascending per check.
- [ ] Object `Loot:` is last.
- [ ] Combat enemies use unindented enemy bullets and indented detail bullets.
- [ ] Combat initiative is a modifier and reusable enemies resolve.
- [ ] Item/Ability `Properties:` use bullets.
- [ ] Ability `Lore:` is last.
- [ ] Every Transition `Scene:` matches an existing filename stem.
- [ ] Scene numbers are contiguous from `001` with no gaps, because the sidebar
  displays them and a gap reads as a missing scene.
- [ ] No Transition targets a reference/summary document, and every convergence is
  a scene that is actually played.
- [ ] `Rarity:` values are `1`, `2`, or `3`.
- [ ] No legacy `### Echo` is used.

### Libraries and lore

- [ ] Every `SourceItem:` matches an `items/` filename stem.
- [ ] Every `[enemy=Name]` matches an `enemies/` filename stem.
- [ ] SourceItem and SourceEnemy files contain one canonical card and no H1.
- [ ] SourceEnemy files contain exactly one enemy record and no `Enemies:` label.
- [ ] Every lore filename stem matches its `# Lore:` page name.
- [ ] Lore entries have unique names and no page/entry name contains `/` or `\`.
- [ ] Lore has no page-level prose outside entries.
- [ ] Lore contains no notes about the conversion package itself.
- [ ] Every `[link=...]` target resolves to an on-page card, item, enemy, or typed
  lore page/entry.
- [ ] Every card `LoreRef:` resolves to an existing lore page or entry and is used
  only on NPC, Object/POI, Combat, Item, Ability, or SourceItem.
- [ ] No visible standalone `[item=Name]` token is used.

### Assets and fidelity

- [ ] Every local image/audio reference maps to an included file. Verify by listing
  the asset folders, not by trusting the manifest.
- [ ] No asset is "pending." Zero references and zero files is a valid, shippable
  state; N references and zero files is not.
- [ ] Bare image names have a `.png` file; bare audio names have an `.mp3` file.
- [ ] Nested assets use `/images/...` or `/audio/...` references.
- [ ] No empty asset directive remains, and no `### Picture:` card lacks an image.
- [ ] No fact is stated authoritatively in two documents.
- [ ] No source fact was silently changed or invented.
- [ ] All mandatory clues and branch exits remain reachable.
- [ ] The final files contain no placeholders, omissions, or unresolved notes.

Passing every item in this checklist is the definition of a RendScroll-compatible,
import-ready conversion.
