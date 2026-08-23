# Workplace sentiment annotation guideline

The rules used to label `workplace_sentiment_validation.csv`. They exist so that
the same sentence gets the same label from anyone applying them, and so that a
reader of the results can see what the labels mean rather than guessing.

Every number reported about a sentiment model in this project is measured against
this file. If the labels are wrong, the comparison between models is wrong, and
no amount of care further down the pipeline recovers it.

## What is being labelled

The learner's **judgement of their own session**, as expressed in the sentence.
Not their mood, not whether the session was objectively good, not whether the
sentence is well written.

## The four labels

### `positive` — one judgement, and it is favourable

> "My voice was steady and I did not rush a single answer."
> "I am proud of how I handled the difficult question at the end."

### `negative` — one judgement, and it is unfavourable

> "I froze completely when they pushed back on my point."
> "I am not happy with how I came across."

### `mixed` — two judgements, pointing opposite ways

> "I spoke clearly **but** I ran out of time before finishing."
> "Good eye contact, poor pacing."

### `neutral` — describes what happened, judges nothing

> "It lasted about ten minutes."
> "The scenario was about handling a late delivery."

## The three rules that decide the hard cases

### 1. Hedging is not mixing

A hedge weakens how *sure* the writer is. It does not add a second judgement.

> "I think I did okay but I am not really sure." → **positive**

There is one judgement here — *okay* — and the writer is unconfident about it.
Compare:

> "I did okay but I ran out of time." → **mixed**

Two judgements: *okay*, and *ran out of time*.

**Test:** remove the hedge. If one judgement remains, label that judgement. If two
remain, it is mixed.

### 2. Read the meaning, not the words

> "It was probably fine, nothing went badly wrong." → **positive**

*Nothing*, *badly* and *wrong* all appear, and the sentence says the session went
fine. Negation reverses meaning; the label follows the meaning.

This rule is why the set exists at all: a bag-of-words model cannot apply it, and
sentences of this shape are where those models fail.

### 3. Absence of judgement is not neutrality about a judgement

`neutral` is for sentences that never evaluate anything. A sentence that
evaluates weakly is still positive or negative.

> "Not my worst session, I suppose." → **positive** (weakly, but it is a verdict)
> "I used the practice plan that was assigned to me." → **neutral**

## When it is genuinely unclear

Put the call you lean toward in `label`, and write why in `notes` starting with
`REVIEW:`. Do not leave it blank — a blank row is silently dropped from scoring,
which quietly shrinks the evidence rather than recording the difficulty.

## Recording who decided

`labelled_by`:

- `unreviewed` — a first pass exists, no person has confirmed it
- `human` — a person read the sentence and decided

Set it to `human` on every row you check, including ones you agree with. The
evaluation prints the reviewed share and warns while it is below 1.0, because a
figure measured against unconfirmed labels is weaker evidence and should not be
quoted as though it were not.

## Rows that are not learner text

`source` separates them:

- `learner` — written by a real user of this system, read from `feedback_entries`
- `authored` — written for this file, to cover phrasings the small real set does
  not contain

Results are always reported per source. Authored rows outnumber learner rows,
so a headline figure carried by them is a figure about whoever wrote them. They
support the measurement; they do not stand in for real data.
