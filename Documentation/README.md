# RendScroll Renderer Guide

RendScroll renders a Markdown adventure sheet into a table-ready scene layout. Write the file in the order the game will happen: the renderer expects a linear sequence of events, and each event should contain every NPC, object, check, item, ability, combat note, and contingency needed at that point in play.

The goal is not to archive lore. The goal is to give the GM a sheet that can be run at the table with minimal scanning.

## Quick Start

Create a Markdown scene with this shape:

```md
# Scene Name
Estimated Time: 20 minutes

Summary: One sentence explaining what happens in this scene.

Goals:
- Introduce the main problem.
- Give the party a clear choice.
- Reveal one useful clue.

---

## Scene 1: First Event
> Read-aloud text written exactly as the GM should say it.
- Extra information that is not obvious immediately.
- Notes the GM can reveal if the party asks or investigates.
`Private GM note: the real purpose of this event.`

### NPC: Character Name
Personality:
- Short trait.
- Short trait.
First Greeting:
- "Who are you?"
> "A complete answer or line of dialogue."

### Skill Checks
General:
- Passive Perception:
> 10: Information most characters could notice.
> 15: Information only alert characters notice.
- Investigation:
> 12: Useful detail.
> 16: Better detail.

### Unexpected: Event Complications
- If the party ignores the clue: move the clue to the next location.
Failed check:
- Investigation failed: progress is not blocked, but the party misses the detail.
```

Use `#` for the scene-level header, `##` for each linear event, and `###` for renderable cards inside that event.

## Core Principle: Linear Event Flow

A rendered sheet should read from top to bottom in play order.

Do not group all NPCs in one section, all objects in another section, and all checks somewhere else. Put each piece under the event where it becomes relevant.

Good structure:

```md
## Scene 2: Broken Toll Gate
> The road narrows between two leaning stone posts...

### Object: Broken Toll Gate
...

### Skill Checks
...

### Item: Blue Wax Seal
...
```

Avoid this structure:

```md
## All NPCs
...

## All Objects
...

## All Skill Checks
...
```

The renderer is built for scenes that can be read and run immediately.

## Render Levels

The heading level controls how the page is rendered.

- `# Scene Name` creates a full-width scene header. Content under `#` renders across the full page until the first `##`.
- `## Scene N: Event Name` starts a linear event. Event body content renders in the left column.
- `### Card Type: Card Name` creates a card. Cards default to the left column unless configured otherwise.

Example:

```md
# The Missing Wagon
Estimated Time: 20 minutes

Summary: The party follows signs of a missing caravan.

---

## Scene 1: Gatehouse Questions
> Rain taps against the gatehouse roof...

### NPC: Orren Vale
...
```

## Columns

RendScroll splits event content into left and right columns. Cards render in the left column by default.

Add `Side: R` inside any card to move it to the right column:

```md
### Object: Broken Toll Gate
Side: R
> The gate arm has been split by a single heavy impact.
```

`Side: L` explicitly keeps a card in the left column, but it is usually unnecessary.

`Side:` is case-insensitive. `R`, `Right`, and `right` all mean right column. The line is not displayed in the rendered output.

## Scene Header

Every scene should start with:

```md
# Scene Name
Estimated Time: 20 minutes

Summary: One sentence explaining what happens.

Goals:
- Goal 1.
- Goal 2.
```

Keep the summary short. It is for GM orientation, not player narration.

Goals should explain what the scene must accomplish in play: introduce a lead, spend resources, reveal a danger, force a choice, or move the party to the next location.

## Events

Events use `##` headings.

```md
## Scene 2: Broken Toll Gate
> The road narrows between two leaning stone posts. A shattered wooden arm blocks half the path, and fresh mud has dried in deep wheel ruts.
- The ruts turn away from the road and toward the marsh.
- A strip of blue wax is caught under a nail.
`This event points to the hidden route.`
```

Write each event as a playable beat:

- Start with complete read-aloud text in a blockquote.
- Add short bullet points for hidden, optional, or follow-up information.
- Put private GM notes in inline code.
- Place all relevant cards directly underneath the event.

## Read-Aloud Text

Anything the GM should read directly to players must be written as a blockquote:

```md
> A stone bridge crosses a slow black channel. No birds call here, and the water below reflects a sky with no moon.
```

Do not write summaries inside blockquotes.

Bad:

```md
> Describe the cursed body and mention that it looks recent.
```

Good:

```md
> A body lies beside the road with one hand still clenched around a broken holy symbol. The mud around it is fresh, but no rain touches the corpse.
```

If dialogue or description is spoken in one breath, keep it on one `>` line:

```md
> "This is the third one this week. First the horses returned. Then the wagon vanished. Now the bridge is speaking."
```

Use separate blockquote paragraphs only when you want a real pause:

```md
> The stone door opens with a slow scrape.
>
> Inside, a cold blue flame burns without smoke.
```

## GM Notes

Private GM notes should use inline code:

```md
`The clerk knows more than he admits, but he is afraid of being blamed.`
```

Use GM notes for hidden truth, scene purpose, future reveals, or reminders that should not be read aloud.

Keep them short.

## NPC Cards

Use `### NPC: Name`.

```md
### NPC: Orren Vale
Personality:
- Polite under pressure.
- Avoids naming anyone important unless pressed.
Race: Human
Age: 52
Occupation: Gatehouse Clerk
Alignment: Lawful Neutral
HP: 9
AC: 10
Image: p1
First Greeting:
- "Who are you?"
> "If you came for the west road, write your names here and do not linger by the old bridge."
Missing Caravans:
- "What happened to the last caravan?"
> "They paid the toll at dusk. Their horses came back before dawn, still harnessed, but the wagon was gone."
Checks:
- Insight:
> 12: Orren is more frightened of the bridge than of the missing caravan.
> 16: He saw a silver lantern hanging below the bridge.
```

Recommended NPC fields:

- `Personality:` short traits.
- `Race:`, `Age:`, `Occupation:`, `Alignment:`, `HP:`, `AC:` when useful.
- `Image:` optional image key used by the renderer.
- Dialogue topics as plain `Topic Name:` labels.
- `Checks:` for checks specific to the NPC.

Do not use `####` for dialogue topics. A plain `Topic Name:` line creates a dialogue subsection inside the NPC card.

## Object Cards

Use `### Object: Name`.

```md
### Object: Broken Toll Gate
> The gate arm has been split by a single heavy impact. Iron nails jut from the wood like crooked teeth.
Image: skull

Checks:
- Investigation:
> 10: The gate was broken from the road side.
> 15: One wagon stopped here long enough for someone to unload a heavy object.
- Survival:
> 12: Four people walked away from the wagon toward the marsh.

Loot:
- Blue wax seal
- Bent toll spike
```

Object cards work well for locations, clues, doors, devices, remains, containers, and interactable scenery.

Common fields:

- Read-aloud blockquote.
- `Image:` optional image key.
- `Checks:` nested skill results.
- `Loot:` short list of things the party can take.

## Skill Checks

Use `### Skill Checks` when checks belong to the whole event, or put `Checks:` inside an NPC or object when checks belong to that card.

```md
### Skill Checks
General:
- Passive Perception:
> 10: The water below the bridge is moving against the wind.
> 15: A faint voice repeats the same name beneath the stones.
- Investigation:
> 12: Scratches on the bridge rail match wagon wheel iron.
> 16: The scratches stop at the center of the bridge.
- Arcana:
> 13: The bridge holds a minor echo enchantment.
```

Use short results. Each result should give the GM usable information immediately.

Supported style:

```md
- Skill Name:
> DC: Result.
> DC: Better result.
```

You can also use raw ability checks:

```md
- Strength:
> 14: The character can hold the gate open long enough for another character to pass.
- Dexterity:
> 14: The mechanism can be held open without tools.
```

The renderer recognizes common D&D skill names and ability names. It can render icons for skill families and ability checks.

Information spells can be written as full names or short forms:

- `SWD:` or `Speak with Dead:`
- `DT:` or `Detect Thoughts:`
- `SWA:` or `Speak with Animals:`

Example:

```md
- Speak with Dead:
> 1: "Lantern."
> 2: "Below."
> 3: "Do not answer."
```

Failed checks belong in `Unexpected:`, not in the check list. Failure should change texture, cost, or clarity. It should not block progress.

## Item Cards

Use `### Item: Name`.

```md
### Item: Lantern of Still Rain
Type: Wondrous Item
Rarity: 2
Image: angel
> This brass lantern burns with a pale blue flame that does not flicker in wind or rain.

Properties:
- While lit, rain within 10 feet falls straight down and makes no sound.
- Once per long rest, the holder can reveal invisible footprints in wet ground for 10 minutes.
- The lantern goes dark for 1 hour if it is fully submerged.
```

Item fields:

- `Type:` item category.
- `Rarity:` numeric rarity. Use `1` for Common, `2` for Rare, and `3` for Epic.
- `Image:` optional image key.
- Read-aloud or description blockquote.
- `Properties:` mechanical bullet list.

## Ability Cards

Use one of these headings:

- `### Skill: Name`
- `### Spell: Name`
- `### Passive: Name`
- `### Effect: Name`

The heading keyword becomes the card label.

```md
### Spell: Trace the Drowned Road
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

Ability fields:

- `Type:` category.
- `Cost:`, `Range:`, `Cooldown:` metadata.
- `Rarity:` numeric rarity.
- Description blockquote.
- `Properties:` mechanical bullet list.
- `Lore:` optional lore panel. Put lore text under it as a blockquote.

## Combine Cards

Use `Combine: T` to visually attach an item or ability to the card immediately above it.

This is useful when an object contains an item, or an item grants a spell or passive.

```md
### Object: Broken Toll Gate
> The gate arm has been split by a single heavy impact.

Loot:
- Blue wax seal
- Lantern of Still Rain

### Item: Lantern of Still Rain
Type: Wondrous Item
Rarity: 2
Combine: T
> This brass lantern burns with a pale blue flame that does not flicker in wind or rain.

Properties:
- Once per long rest, the holder can reveal invisible footprints in wet ground for 10 minutes.

### Spell: Trace the Drowned Road
Type: Divination
Cost: 1 Action
Range: Self
Cooldown: 1 Long Rest
Rarity: 2
Combine: T
> The lantern flame stretches into a thread of light and marks the path most recently taken by a soaked creature or wagon.
```

Rules for `Combine: T`:

- The combined card must appear immediately after its host card.
- The card follows the host card's column.
- A combined card can attach to an object, item, or another combined card.
- If another card, event, or separator appears between them, the card renders normally.
- The `Combine:` line is not displayed.

Truthy values include `T`, `true`, `yes`, and `1`.

## Combat Cards

Use a combat card only for the information needed to run the fight quickly.

Current renderer keyword: `Savaş`.

The card body can still use English labels such as `Stats:` and `Tactics:`, but the heading trigger should be `Savaş` so the combat renderer recognizes it.

```md
### Savaş: Cursed Villager
> The villager turns with a wet gasp and rushes forward, eyes wide and empty.
Stats:
- AC 10 | HP 11 | Speed 30 ft
- Attack: Claw +3, 1d6 slashing
- Weak save: Wisdom
Tactics:
- Attacks the nearest visible creature.
- Does not retreat unless restrained.
`This fight should prove the curse is real, not drain party resources.`
```

Keep combat compact. Do not paste full monster stat blocks unless the renderer sheet is meant to replace the monster reference entirely.

If a future renderer version adds an English `Combat:` trigger, keep one convention per campaign file.

## STD Cards

Use `### STD: Name` for simple standard text beats that do not need a specialized card type.

```md
### STD: Road Opens
> Past the bridge, the road bends between tall reeds. The wagon tracks continue forward, but a second trail of footprints cuts away toward a ruined watch post.
The party can follow either trail without making a check.
```

STD cards are useful for summaries, transitions, warnings, travel beats, or non-interactive information.

## Unexpected Cards

Use `### Unexpected: Name` for contingencies, detours, and failed checks.

```md
### Unexpected: Bridge Complications
- If the party calls back to the voices: the water answers with one true memory from the speaker, then a false direction.
- If the party crosses without stopping: they reach the far side safely, but one character hears their name from under the bridge later that night.
- If the party destroys part of the bridge: the echo breaks for 1 hour, revealing the hidden hook under the central rail.
Failed check:
- Investigation failed: they still notice the wagon trail, but not the hidden hook.
- Arcana failed: they know the bridge is magical, but not how the voices choose their words.
```

Use this card to protect the scene from stalling.

Good contingency writing:

- "If the party does X: consequence."
- "If they skip X: where the clue appears next."
- "Failed check: what they still learn, and what they miss."

Do not make failed checks stop progress unless the adventure has another obvious route forward.

## Echo Beats

Use echo beats for visions, memories, or supernatural impressions from the past.

For an English rendered card, use `STD` with an echo title:

```md
### STD: Echo - Bridge Memory
> A wagon wheel turns in moonlit mud. Someone below the bridge whispers a name, and every horse stops breathing at once.
`The players should understand that the bridge witnessed the abduction, but not who caused it.`
```

Echo beats should be complete read-aloud text. They should imply meaning without directly naming hidden roles or future twists.

## Images

Many cards can include:

```md
Image: p1
```

The value should match an image key known to the renderer, such as a portrait, symbol, item image, or scene asset. Use images when they help the GM recognize a card quickly or present a visual to players.

The `Image:` line is metadata. Keep the actual description in the blockquote.

## Writing Rules

Use these rules to keep sheets renderer-friendly and table-friendly:

- Use `-` for bullet points.
- Keep information bullets short.
- Write every player-facing description completely.
- Keep private GM information in inline code.
- Do not add unnecessary blank lines inside cards.
- Keep one-breath dialogue on one blockquote line.
- Put lore in a separate lore file when it is not needed at the table.
- Reference lore briefly if needed, for example: `(Lore 7.2.1)`.
- Keep each event understandable in 30 seconds.

## Complete Template

Copy this template and delete modules you do not need.

```md
# Scene Name
Estimated Time: X minutes

Summary: One sentence explaining what happens in this scene.

Goals:
- Goal 1.
- Goal 2.

---

## Scene 1: Event Name
> Complete read-aloud text written exactly as the GM should say it.
- Extra detail that appears if the party investigates, asks, or waits.
- Optional GM-facing play note.
`Private GM note or real purpose of the event.`

### NPC: Name
Personality:
- Trait.
- Trait.
Race: Human
Age: 40
Occupation: Clerk
HP: 9
AC: 10
Image: p1
First Greeting:
- "Who are you?"
> "Complete answer."
Topic Name:
- "Player question?"
> "Complete answer."
Checks:
- Insight:
> 12: Useful read on the NPC.
> 16: Hidden motive or stronger clue.

### Object: Object Name
> Complete object description.
Image: skull

Checks:
- Investigation:
> 12: Useful clue.
> 16: Stronger clue.
- Arcana:
> 15: Magical clue.

Loot:
- Item name
- Small clue

### Item: Item Name
Type: Wondrous Item
Rarity: 2
Combine: T
> Complete item description.

Properties:
- Mechanical property.
- Mechanical property.

### Spell: Ability Name
Type: Divination
Cost: 1 Action
Range: Self
Cooldown: 1 Long Rest
Rarity: 2
Combine: T
> Complete ability description.

Properties:
- Mechanical property.

Lore:
> Optional short lore text.

### Skill Checks
General:
- Passive Perception:
> 10: Basic observation.
> 15: Stronger observation.
- Investigation:
> 12: Useful clue.
> 16: Stronger clue.
- Speak with Dead:
> 1: "First answer."
> 2: "Second answer."
> 3: "Third answer."

### Savaş: Enemy Name
> Complete opening combat description.
Stats:
- AC X | HP Y | Speed Z
- Attack: attack name +N, damage
- Weak save: ability
Tactics:
- Behavior.
- Behavior.
`Private combat purpose.`

### STD: Echo - Memory Name
> Complete supernatural memory or past image.
`What the party should understand or misunderstand.`

### Unexpected: Event Complications
- If the party does X: consequence or alternate route.
- If the party skips the encounter: where the clue moves.
Failed check:
- Investigation failed: progress continues, but the detail is less precise.

### STD: Transition
> Complete transition or summary text.
Additional GM-facing note if needed.

---

## Scene 2: Next Event
> Continue the scene in play order.
`Private note.`
```

## Practical Checklist

Before rendering, check the file:

- The scene starts with `#`, estimated time, summary, and goals.
- Events use `##` and appear in play order.
- Cards use `###` and sit under the event where they matter.
- Read-aloud text is complete and uses `>`.
- Private GM notes use inline code.
- Skill checks give information instead of blocking progress.
- Failed checks and detours are handled in `Unexpected:`.
- `Side: R` is used only when a card should move to the right column.
- `Combine: T` is used only when a card immediately follows its host.
