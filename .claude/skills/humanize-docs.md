# humanize-docs

Rewrite AI-generated documentation into high-quality, human-style prose.

## Trigger

Use when asked to:
- "humanize" or "rewrite" documentation
- make docs sound less AI-generated
- convert AI docs to human-written style
- clean up generated documentation

## What This Skill Does

This skill rewrites AI-generated technical documentation through a structured
five-pass editing system grounded in research on how humans write versus how
language models write. The goal is prose that reads like a knowledgeable expert
wrote it — not a text polisher, not an executive summary bot.

The underlying theory: AI models predict the most probable next token, which
drives output toward a statistical mean. That produces text that is polished,
symmetrical, predictable, and structurally uniform. Human writing is the
opposite — it is bursty, specific, occasionally imperfect, and carries a
traceable perspective.

---

## The Five-Pass Rewriting System

### Pass 1 — Vocabulary Scrub

Replace or remove every word from the banned list below. Do not just swap one
AI word for another. Use the plainest, most accurate word available.

**Tier 1 — near-certain AI signals (always replace):**
delve, tapestry, pivotal, nuanced, multifaceted, robust, seamless, leverage
(as a verb), streamline, foster, facilitate, elevate, empower, transformative,
holistic, paradigm, synergy, groundbreaking, revolutionary

**Tier 2 — frequent AI indicators (replace when not justified by context):**
crucial, significant, comprehensive, notably, it is worth noting, it is
important to note, key (overused), unique (when used generically), optimal,
cutting-edge, state-of-the-art, best-in-class, dynamic, innovative, utilize
(use "use"), commence (use "start"), endeavor, aforementioned, heretofore

**Tier 3 — transition word abuse (collapse or replace):**
Furthermore, Moreover, Additionally, In addition to the above, In conclusion,
To summarize, It is clear that, This highlights the importance of, Building on
this, It goes without saying, Needless to say, As previously mentioned,
It should be noted that, Last but not least

**Replacements for common transition abuse:**
- "Furthermore" → delete or use "And" / restructure the sentence
- "Moreover" → delete or fold into the prior sentence
- "In conclusion" → delete; let the last sentence stand as the conclusion
- "It is worth noting that X" → just state X directly

---

### Pass 2 — Structural Pattern Removal

AI text has recognizable structural templates. Break them.

**Patterns to dismantle:**

1. **The tricolon list** — AI loves grouping things in threes with parallel
   syntax: "It is fast, reliable, and scalable." When that grouping is
   mechanical rather than meaningful, collapse it into prose.

2. **The mirror restatement** — Ending a section by restating what was just
   said. Delete the restatement. Let the content land once.

3. **The rhetorical Q&A** — "So what does this mean for developers? It means..."
   Either answer it without the question or restructure entirely.

4. **The double em-dash wrapper** — AI wraps parenthetical thoughts like this
   — which creates a recognizable rhythm — throughout paragraphs. Limit em
   dashes to one per 300 words. Replace most with a comma, parenthesis, or
   period. The pattern of em-dash-wrapped clauses is almost exclusively an AI
   tell.

5. **The bullet-for-everything reflex** — AI converts any set of related ideas
   into a bulleted list. Use lists only when the items are genuinely enumerable
   and parallel. Otherwise, write prose. Three bullet points that could be one
   sentence should be one sentence.

6. **Symmetrical paragraph structure** — AI paragraphs often open with a topic
   sentence, provide two examples, then close with a summary. Break the
   symmetry. Start mid-thought sometimes. Let paragraphs end when the point is
   made, not when the template says to close.

7. **The announcement sentence** — "In this section, we will cover X."
   Delete it. Go directly into X.

8. **The balanced-tradeoff reflex** — AI offers unprompted pros and cons even
   when the answer is one-sided. If the documentation favors an approach, say
   so directly.

9. **Semicolon overuse** — Human prose rarely uses semicolons. Replace most
   with a period and a new sentence.

10. **Mid-sentence colon as a restatement injector** — "The problem: nobody
    tests this." Valid only after a complete independent clause. Otherwise
    restructure.

---

### Pass 3 — Burstiness and Rhythm Enforcement

**Burstiness** is the variation in sentence length. AI text has low burstiness:
sentences cluster in a narrow medium-length band, producing a uniform rhythm
that feels machine-generated even when word choices are acceptable.

**Rules:**
- Include at least one sentence of six words or fewer per 150 words of output.
- Never allow three consecutive sentences within five words of each other in
  length.
- Use long sentences only when the compound thought genuinely requires them.
- Read every paragraph aloud. If it sounds like a metronome, break the rhythm.

**Practical techniques:**
- Follow a long technical explanation with a one-sentence anchor: "This is why
  it matters."
- Start a sentence with "But" or "And" when it improves flow.
- Use a sentence fragment for deliberate emphasis. Sparingly.
- Let some paragraphs be two sentences. Others can run longer.

---

### Pass 4 — Specificity and Perspective Injection

AI text makes abstract claims without grounding them. Human experts write from
accumulated knowledge — they cite the specific version, the actual error
message, the real company name, the exact tradeoff they ran into.

**Rules:**

- Replace every abstract claim with a concrete anchor. Instead of "many
  databases struggle with this," write "PostgreSQL before version 14 hit this
  exact limit with large jsonb columns."
- Named examples beat generic ones. "Tools like Datadog, Prometheus, and
  Grafana" beats "monitoring tools."
- When describing a process, describe what actually happens, not a sanitized
  version: "This will fail if the lock is held by another process — and it
  will not tell you why."
- Add the expert's note: what catches people, what is counterintuitive, what
  the documentation usually skips.
- First-person is permitted for documentation that benefits from a traceable
  voice: "We found that…", "The approach we recommend is…"

---

### Pass 5 — Hedge Surgery and Register Normalization

AI text hedges constantly. It softens, qualifies, and wraps every claim in
uncertainty language regardless of whether uncertainty exists. This is an
artifact of instruction-tuning (RLHF) that trained models to be cautious and
balanced even when the answer is clear.

**Remove unconditionally:**
- "It is important to note that…"
- "Generally speaking…"
- "In many cases…"
- "Typically…" (when not factually necessary)
- "It could be argued that…"
- "One might consider…"
- "This may or may not be…"
- Acknowledgment openers: "That's a great question…", "Certainly!", "Of
  course!", "Absolutely!"
- Hedged closers: "I hope this helps!", "Feel free to reach out if you have
  more questions!"

**Replace hedged claims with direct ones:**
- "It is generally recommended to use X" → "Use X."
- "You may want to consider Y" → "Consider Y." or just tell them to do Y.
- "In most cases, Z will work" → "Z works. Exception: [specific case]."

**Preserve hedges only when genuinely factual:** version-specific behavior,
platform-specific differences, truly uncertain outcomes.

**Register:** Match the register of the surrounding documentation. Technical
reference stays neutral and direct. Tutorials can be warmer. Do not add warmth
to reference documentation and do not strip it from conceptual guides.

---

## Quality Checklist

Before returning the rewritten documentation, verify each item:

- [ ] No Tier 1 banned words remain
- [ ] No Tier 2 banned words remain without justification
- [ ] No mirrored restatements (content does not say the same thing twice)
- [ ] No announcement sentences ("In this section we will…")
- [ ] Em dash count: ≤1 per 300 words
- [ ] Semicolons: none unless genuinely necessary
- [ ] Bullet lists: only where items are truly enumerable and parallel
- [ ] Sentence length varies — at least one short sentence per 150 words
- [ ] No three consecutive same-length sentences
- [ ] Every abstract claim is grounded with a specific anchor
- [ ] All unconditional hedges are removed
- [ ] No AI transition word clusters (Furthermore / Moreover / Additionally
      appearing near each other)
- [ ] Reading it aloud: no metronome rhythm
- [ ] The opening sentence earns attention — it does not announce the topic

---

## What Not To Do

**Do not manufacture humanity.** No fake typos, forced contractions where they
do not fit the register, staged imperfections, or invented colloquialisms.
Authentic human writing is not messy — it is precise in a different way than
AI precision. The goal is not to introduce errors; it is to remove statistical
uniformity.

**Do not strip technical accuracy.** Every rewrite must preserve the exact
technical meaning of the original. Simplifying the prose must never simplify
the claim. If a technical term is the right term, keep it even if it sounds
formal.

**Do not over-humanize.** Not every document needs personality. A REST API
reference does not benefit from rhetorical questions. Apply voice and warmth
where the register calls for it; elsewhere, clarity and directness are enough.

**Do not replace one template with another.** The enemy is uniformity. A
rewrite that hits the same beats every section — specificity anchor, short
sentence, concrete example — is still templated. Vary the application of these
techniques.

---

## How to Apply This Skill

1. Read the full input documentation before making any changes.
2. Identify the document type (tutorial, reference, conceptual guide, README,
   changelog, etc.) and calibrate register accordingly.
3. Run Pass 1 through Pass 5 in order. Earlier passes affect what later passes
   need to do.
4. Verify against the quality checklist.
5. Return the rewritten documentation only — no meta-commentary, no
   explanation of what was changed, no before/after comparison unless
   explicitly requested.

If the original documentation has severe structural problems (wrong information,
missing context, logical gaps), flag them separately after the rewrite rather
than silently fixing them. The rewrite is a voice and style transformation, not
a content audit.

---

## Example Transformations

**Before (AI-generated):**
> It is important to note that leveraging this feature can significantly
> enhance the performance of your application. Furthermore, it provides a
> seamless experience for end users. In conclusion, this is a pivotal
> component of the system architecture.

**After (humanized):**
> This feature cuts response time by removing the round-trip to the auth
> server. Users see the difference immediately — login drops from ~400ms to
> under 50ms in most deployments. It is one of the few optimizations that
> requires no trade-off.

---

**Before (AI-generated):**
> The following steps outline the process for configuring the database
> connection. This process involves several key steps that must be completed
> in order.

**After (humanized):**
> Configure the database connection in three steps. Order matters — the pool
> initializes before the schema check runs, and if you reverse them, the
> schema check will always fail with a cryptic timeout.

---

Sources used in building this skill:
- [lguz/humanize-writing-skill](https://github.com/lguz/humanize-writing-skill)
- [harshaneel/humanize](https://github.com/harshaneel/humanize)
- [Anbeeld/WRITING.md](https://github.com/Anbeeld/WRITING.md)
- [blader/humanizer](https://github.com/blader/humanizer)
- [Burstiness & Perplexity — QuillBot](https://quillbot.com/blog/ai-writing-tools/burstiness-and-perplexity/)
- [How to Write Like a Human — GPTZero](https://gptzero.me/news/how-to-write-like-a-human/)
- [How to Rewrite AI-Generated Text — QuillBot](https://quillbot.com/blog/ai-writing-tools/how-to-rewrite-ai-generated-text/)
- [Natural AI Writing Techniques — Human Writes](https://humanwritesai.com/blog/natural-ai-writing-techniques-that-work)
