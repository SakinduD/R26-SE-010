import { ChevronLeft, ChevronRight } from 'lucide-react'

// Back/Continue float at the left and right edges of the feedback page
// itself, vertically centered — via the "sticky centering" trick: each
// button sits in a full-height rail positioned within .fb-shell (not the
// raw viewport), so it always tracks the feedback content's own edges
// instead of the app's sidebar (which is a *sibling* of this page, not an
// ancestor — a plain `position:fixed; left:20px` rendered on top of it
// regardless of whether the sidebar was collapsed or expanded). The inner
// button's `position:sticky; top:50%` then keeps it vertically centered in
// the viewport as the page scrolls, the same way `position:fixed` would,
// but scoped horizontally to the rail's box instead of the whole screen.
// Below 900px there isn't room for side rails without crowding the text,
// so it falls back to a classic bottom bar (offset above the app's own
// mobile tab bar).
export default function FeedbackNavigation({ onBack, onNext, backDisabled }) {
  return (
    <>
      <div className="fn-rail fn-rail-left">
        <button type="button" onClick={onBack} disabled={backDisabled} className="fn-side fn-back" aria-label="Back">
          <ChevronLeft size={20} strokeWidth={2} />
        </button>
      </div>
      <div className="fn-rail fn-rail-right">
        <button type="button" onClick={onNext} className="fn-side fn-next" aria-label="Continue">
          <ChevronRight size={20} strokeWidth={2} />
        </button>
      </div>

      <div className="fn-wrap-mobile">
        <div className="fn-inner">
          <button type="button" onClick={onBack} disabled={backDisabled} className="btn-c secondary">
            Back
          </button>
          <button type="button" onClick={onNext} className="btn-c primary">
            Continue <ChevronRight size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <style>{`
        .fn-rail{
          position:absolute; top:0; bottom:0; width:48px; pointer-events:none; z-index:30;
        }
        .fn-rail-left{ left:20px; }
        .fn-rail-right{ right:20px; }

        .fn-side{
          position:sticky; top:50%; transform:translateY(-50%); pointer-events:auto;
          display:flex; align-items:center; justify-content:center;
          width:48px; height:48px; border-radius:50%;
          border:1px solid var(--border); background:var(--surface); color:var(--text-hi);
          cursor:pointer; box-shadow:0 8px 22px rgba(0,0,0,0.14);
          transition:filter .2s var(--ease), transform .2s var(--ease), opacity .2s var(--ease);
        }
        .fn-side:hover{ filter:brightness(1.06); }
        .fn-side:disabled{ opacity:.35; cursor:not-allowed; }
        .fn-next{
          border-color:transparent; color:#fff;
          background:linear-gradient(135deg, var(--accent), #9B6BFF); box-shadow:0 8px 22px var(--accent-glow);
        }

        .fn-wrap-mobile{ display:none; }

        @media (max-width:900px){
          .fn-rail{ display:none; }
          .fn-wrap-mobile{
            display:block; position:fixed; left:0; right:0; bottom:0; z-index:30;
            background:var(--surface); border-top:1px solid var(--border); box-shadow:0 -4px 16px rgba(0,0,0,0.08);
          }
          .fn-inner{ max-width:1200px; margin:0 auto; padding:14px 24px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
        }
        @media (max-width:768px){
          .fn-wrap-mobile{ bottom:70px; }
        }
      `}</style>
    </>
  )
}
