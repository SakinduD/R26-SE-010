import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth/context';
import PageHead from '@/components/ui/PageHead';
import Card from '@/components/ui/Card';
import Banner from '@/components/ui/Banner';
import TabNav from '@/components/ui/TabNav';
import TextInput from '@/components/ui/TextInput';
import Button from '@/components/ui/Button';
import KeyValuePair from '@/components/ui/KeyValuePair';

const TABS = [
  { label: 'Account',     value: 'account' },
  { label: 'Preferences', value: 'preferences' },
  { label: 'Privacy',     value: 'privacy' },
  { label: 'Research',    value: 'research' },
];

export default function Settings() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState('account');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [keyboardHints, setKeyboardHints] = useState(true);
  const [optOutResearch, setOptOutResearch] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    toast.success('Signed out');
    navigate('/');
  };

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow="Account"
        title="Settings"
        sub="Manage your account, preferences, and research data."
      />

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '0 20px' }}>
          <TabNav value={tab} onChange={setTab} options={TABS} />
        </div>

        <div style={{ padding: 24 }}>
          {tab === 'account' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <TextInput
                label="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                helper="Shown in the sidebar and on your training plan."
              />
              <div className="field">
                <span className="field-label">Email</span>
                <div
                  className="input"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    color: 'var(--text-tertiary)',
                    cursor: 'not-allowed',
                  }}
                >
                  {user?.email || '—'}
                </div>
                <span className="field-helper">Email is read-only. Contact support to change it.</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  onClick={() => toast.success('Display name saved')}
                  disabled={!displayName.trim() || displayName === user?.display_name}
                >
                  Save changes
                </Button>
                <Button variant="ghost">Change password</Button>
                <Button variant="ghost" onClick={handleSignOut}>
                  Sign out
                </Button>
              </div>
            </div>
          )}

          {tab === 'preferences' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Banner variant="info">
                The application is dark-mode only by design. Light theme is not supported in this release.
              </Banner>
              <ToggleRow
                label="Reduce motion"
                helper="Disables stagger animations and transitions."
                checked={reducedMotion}
                onChange={setReducedMotion}
              />
              <ToggleRow
                label="Keyboard hints"
                helper="Show keyboard-shortcut tips on first use of each page."
                checked={keyboardHints}
                onChange={setKeyboardHints}
              />
            </div>
          )}

          {tab === 'privacy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <KeyValuePair k="Tokens stored" v="Locally in browser localStorage" />
              <KeyValuePair k="Voice recordings" v="Processed on-device when possible" />
              <KeyValuePair k="Research consent" v={optOutResearch ? 'Opted out' : 'Opted in'} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <Button variant="ghost">Export my data</Button>
                <Button variant="danger">Delete my account</Button>
              </div>
            </div>
          )}

          {tab === 'research' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p className="t-body" style={{ color: 'var(--text-secondary)' }}>
                EmpowerZ is a SLIIT research project investigating personality-adaptive soft-skill training.
                Your anonymised data helps us evaluate the adaptation thesis. You can opt out at any time.
              </p>
              <ToggleRow
                label="Opt out of research data collection"
                helper="Your future sessions will not contribute to the research dataset."
                checked={optOutResearch}
                onChange={setOptOutResearch}
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function ToggleRow({ label, helper, checked, onChange }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '12px 0',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="fg" style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        {helper && <div className="t-cap" style={{ marginTop: 2 }}>{helper}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          width: 40,
          height: 22,
          borderRadius: 999,
          background: checked ? 'var(--accent)' : 'var(--bg-input)',
          border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-default)'}`,
          position: 'relative',
          cursor: 'pointer',
          transition: 'all var(--dur-fast) var(--ease)',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 20 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'white',
            transition: 'left var(--dur-fast) var(--ease)',
          }}
        />
      </button>
    </div>
  );
}
