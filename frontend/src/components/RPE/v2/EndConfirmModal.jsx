// Confirmation before ending early — "End" is a quiet text action in the
// bottom row (see RolePlaySessionV2.jsx), not a large red button, but
// ending a session is still a one-way action worth a beat of confirmation.
export default function EndConfirmModal({ onCancel, onConfirm }) {
  return (
    <div className="rps2-confirm-backdrop" onClick={onCancel}>
      <div className="rps2-confirm-modal" role="dialog" aria-label="End session confirmation" onClick={(e) => e.stopPropagation()}>
        <p className="rps2-confirm-title">End this session?</p>
        <p className="rps2-confirm-body">
          Your progress will be saved and you can still view your feedback.
        </p>
        <div className="rps2-confirm-actions">
          <button type="button" className="rps2-confirm-cancel" onClick={onCancel}>Continue</button>
          <button type="button" className="rps2-confirm-end" onClick={onConfirm}>End session</button>
        </div>
      </div>
    </div>
  )
}
