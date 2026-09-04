// The brief contextual transition before the three response cards — makes
// the moment read as "a colleague just asked me for something concrete,"
// not "answer this multiple-choice question."
//
// Eyebrow deliberately reads "Your response", not "Handoff request" — this
// component renders for every deliverable_choice turn regardless of what
// it's actually about (committing to a deadline, negotiating a dependency,
// agreeing to send a document, ...), and the backend has no field
// distinguishing which of those it is. "Handoff" was only ever accurate
// for some of them; a label that's true for all of them beats one that
// overclaims for most of them.
export default function HandoffPrompt() {
  return (
    <div className="rcc2-prompt">
      <p className="rcc2-prompt-eyebrow">Your response</p>
      <p className="rcc2-prompt-question">What would you say?</p>
    </div>
  )
}
