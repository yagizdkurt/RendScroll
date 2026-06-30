/* Audio card renderer.
   A small sound-effect / music player dropped into a scene. Authored as
   "### Audio: Optional Caption" with a "File:" line naming an mp3 in the
   audio/ folder. Renders the native HTML5 <audio controls> widget — a play
   button, a seek line, and a current/total time readout — kept compact via CSS.

   It reuses the shared Side: column directive (cardImage.js) but resolves its
   media source itself (audioSrcUrl): a bare name -> /audio/<name>.mp3. The
   launcher serves the repo root, so /audio/* is already reachable. It never
   fetches files or touches the sidebar.

   The card renders in the left column by default; a "Side: R" line moves it to
   the right column. */

/* Resolve a "File: name" value into a usable audio url. A bare name with no
   extension defaults to ".mp3", and a name without a path is looked up under
   audio/. So "tavern", "tavern.mp3" and "audio/tavern.mp3" all work, and
   absolute urls / rooted paths are left untouched. Mirrors cardBgUrl(). */
function audioSrcUrl(raw) {
  let file = raw.trim();
  if (!/\.[a-z0-9]+$/i.test(file)) file += ".mp3";
  if (/^[a-z]+:\/\//i.test(file) || file.startsWith("/")) return file;
  return /[\/\\]/.test(file) ? "/" + file.replace(/\\/g, "/").replace(/^\/+/, "") : "/audio/" + file;
}

// Build one Audio card from its parsed AST node. File/Side come straight from the
// resolved directives; any remaining prose body renders through marked.
function buildAudioCard(cardNode, head, nodes) {
  const card = document.createElement("div");
  card.className = "audio-card";

  // Optional caption after the colon ("### Audio: Tavern" -> "Tavern").
  const caption = head.textContent.trim().replace(/^\s*audio\s*:\s*/i, "").trim();

  const fileRaw = cardDirective(cardNode, "file").trim();
  if (cardIsRight(cardNode)) card.classList.add("card-right");

  // Any non-directive body the author wrote renders as plain content below.
  cardBodyElements(cardNode).forEach((n) => card.appendChild(n));

  // A slim header row holds the caption label and the native player side by
  // side so the card reads as a single compact strip. Any extra body nodes the
  // author wrote sit below it.
  const row = document.createElement("div");
  row.className = "audio-row";

  // A small speaker glyph marks the strip as a sound cue even before play.
  const icon = document.createElement("span");
  icon.className = "audio-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "♪";
  row.appendChild(icon);

  if (caption) {
    const cap = document.createElement("span");
    cap.className = "audio-caption";
    cap.textContent = caption;
    row.appendChild(cap);
  }

  // The player is the whole point of the card; render the native compact widget.
  if (fileRaw) {
    const audio = document.createElement("audio");
    audio.setAttribute("controls", "");
    audio.setAttribute("preload", "metadata");
    audio.src = audioSrcUrl(fileRaw);
    row.appendChild(audio);
  }

  card.insertBefore(row, card.firstChild);

  return card;
}

/* Self-register with the runtime card registry (cards/shared/cardRegistry.js).
   No normalizer: the builder reads directives/body from the parsed AST node. */
if (typeof RendScrollCards !== "undefined") {
  RendScrollCards.register("audio", { build: buildAudioCard });
}
