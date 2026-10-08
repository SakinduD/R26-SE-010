import React, { useState } from 'react';
import {
  Sparkles,
  Lightbulb,
  Inbox,
  RefreshCw,
  Mic,
  CheckCircle2,
} from 'lucide-react';

import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import StatCard from '@/components/ui/StatCard';
import EmptyState from '@/components/ui/EmptyState';
import Banner from '@/components/ui/Banner';
import ScoreBar from '@/components/ui/ScoreBar';
import ScoreBarRow from '@/components/ui/ScoreBarRow';
import RadialScore from '@/components/ui/RadialScore';
import RadarChart from '@/components/ui/RadarChart';
import LineChart from '@/components/ui/LineChart';
import BarChart from '@/components/ui/BarChart';
import DistributionStrip from '@/components/ui/DistributionStrip';
import TabNav from '@/components/ui/TabNav';
import AccordionItem from '@/components/ui/AccordionItem';
import PageHead from '@/components/ui/PageHead';
import Section from '@/components/ui/Section';
import KeyValuePair from '@/components/ui/KeyValuePair';
import SegmentedControl from '@/components/ui/SegmentedControl';
import ChipToggle from '@/components/ui/ChipToggle';
import LikertOption from '@/components/ui/likert-option';
import TextInput from '@/components/ui/TextInput';
import PasswordInput from '@/components/ui/PasswordInput';
import CountUp from '@/components/ui/CountUp';

const TRAITS = [
  { letter: 'O', label: 'Openness',          value: 72, level: 'HIGH' },
  { letter: 'C', label: 'Conscientiousness', value: 64, level: 'MID' },
  { letter: 'E', label: 'Extraversion',      value: 41, level: 'MID' },
  { letter: 'A', label: 'Agreeableness',     value: 78, level: 'HIGH' },
  { letter: 'N', label: 'Neuroticism',       value: 33, level: 'LOW' },
];

const RADAR_DATA = [
  { label: 'Communication', value: 76 },
  { label: 'Empathy',       value: 82 },
  { label: 'Assertiveness', value: 58 },
  { label: 'Clarity',       value: 71 },
  { label: 'Composure',     value: 69 },
];

const LINE_DATA = [60, 64, 62, 70, 72, 68, 74, 78, 76, 80];

export default function Styleguide() {
  const [seg, setSeg] = useState('intermediate');
  const [tab, setTab] = useState('overview');
  const [chips, setChips] = useState({ a: true, b: false, c: false });
  const [likert, setLikert] = useState(3);

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow="Documentation"
        title="Styleguide"
        sub="24 components, every state. Source of truth for the EmpowerZ design system."
      />

      {/* TOKENS */}
      <Section title="Design tokens" sub="OKLCH colors · 4-tier text · 3-tier border" topRule={false}>
        <div className="grid-3">
          <Card>
            <div className="t-over" style={{ marginBottom: 12 }}>Surfaces</div>
            <div className="col" style={{ gap: 8 }}>
              {['bg-canvas', 'bg-surface', 'bg-elevated', 'bg-input'].map((t) => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: `var(--${t})`,
                    border: '1px solid var(--border-subtle)',
                  }} />
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>--{t}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <div className="t-over" style={{ marginBottom: 12 }}>Text</div>
            <div className="col" style={{ gap: 8 }}>
              <div style={{ color: 'var(--text-primary)' }}>--text-primary</div>
              <div style={{ color: 'var(--text-secondary)' }}>--text-secondary</div>
              <div style={{ color: 'var(--text-tertiary)' }}>--text-tertiary</div>
              <div style={{ color: 'var(--text-quaternary)' }}>--text-quaternary</div>
            </div>
          </Card>
          <Card>
            <div className="t-over" style={{ marginBottom: 12 }}>Chart palette</div>
            <div className="col" style={{ gap: 8 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: `var(--chart-${n})`,
                  }} />
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>--chart-{n}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </Section>

      {/* TYPOGRAPHY */}
      <Section title="Typography" sub="Geist Variable · JetBrains Mono for numerals" topRule>
        <Card>
          <div className="t-display" style={{ marginBottom: 12 }}>The quick brown fox.</div>
          <div className="t-h1" style={{ marginBottom: 12 }}>Heading 1 (40px)</div>
          <div className="t-h2" style={{ marginBottom: 12 }}>Heading 2 (28px)</div>
          <div className="t-h3" style={{ marginBottom: 12 }}>Heading 3 (20px)</div>
          <div className="t-body-lg">Body large — 16px line-height 1.6.</div>
          <div className="t-body">Body — 14px line-height 1.6.</div>
          <div className="t-cap">Caption — 12px tracking 0.01em.</div>
          <div className="t-over">Overline — 11px tracking 0.08em uppercase.</div>
          <div className="score-num" style={{ fontSize: 28, marginTop: 12 }}>0123456789 · score-num</div>
        </Card>
      </Section>

      {/* BUTTONS */}
      <Section title="Buttons" topRule>
        <Card>
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            <Button size="sm">Small</Button>
            <Button>Medium</Button>
            <Button size="lg">Large</Button>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
            <IconButton aria-label="Refresh"><RefreshCw size={14} strokeWidth={1.6} /></IconButton>
            <IconButton aria-label="Lightbulb" size="sm"><Lightbulb size={12} strokeWidth={1.6} /></IconButton>
            <IconButton aria-label="Sparkles" size="lg"><Sparkles size={16} strokeWidth={1.6} /></IconButton>
          </div>
        </Card>
      </Section>

      {/* INPUTS */}
      <Section title="Inputs" topRule>
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <Card>
            <div className="col" style={{ gap: 16 }}>
              <TextInput label="Default" placeholder="Type here" name="sg-default" />
              <TextInput label="With error" name="sg-error" defaultValue="bad" error="Try again." />
              <TextInput label="Success" name="sg-success" defaultValue="ok" success />
              <PasswordInput label="Password" name="sg-pw" defaultValue="P@ssword12" />
              <div>
                <div className="t-cap" style={{ marginBottom: 6 }}>Likert</div>
                <div className="likert-row">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <LikertOption
                      key={v}
                      value={v}
                      label={v}
                      selected={likert === v}
                      onSelect={setLikert}
                    />
                  ))}
                </div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="col" style={{ gap: 16 }}>
              <SegmentedControl
                value={seg}
                onChange={setSeg}
                options={[
                  { label: 'Beginner', value: 'beginner' },
                  { label: 'Intermediate', value: 'intermediate' },
                  { label: 'Advanced', value: 'advanced' },
                ]}
              />
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(chips).map(([k, v]) => (
                  <ChipToggle
                    key={k}
                    active={v}
                    onClick={() => setChips((s) => ({ ...s, [k]: !s[k] }))}
                  >
                    chip-{k}
                  </ChipToggle>
                ))}
                <ChipToggle staticOnly>chip-static</ChipToggle>
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <Badge>neutral</Badge>
                <Badge variant="accent">accent</Badge>
                <Badge variant="success">success</Badge>
                <Badge variant="warning">warning</Badge>
                <Badge variant="danger">danger</Badge>
                <Badge variant="info">info</Badge>
              </div>
            </div>
          </Card>
        </div>
      </Section>

      {/* SURFACES + EMPTY */}
      <Section title="Surfaces" topRule>
        <div className="grid-3">
          <Card>Default card</Card>
          <Card variant="elevated">Elevated card</Card>
          <Card variant="accent">Accent card</Card>
        </div>
        <div style={{ marginTop: 16 }}>
          <Card>
            <EmptyState
              icon={Inbox}
              title="No data yet"
              description="Once you complete a session, results will appear here."
              action={
                <>
                  <Button>Find a scenario</Button>
                  <Button variant="ghost">Skip for now</Button>
                </>
              }
            />
          </Card>
        </div>
      </Section>

      {/* BANNERS */}
      <Section title="Banners" topRule>
        <div className="col">
          <Banner variant="info">Use 1–5 to select · ←/→ to navigate · Enter to advance.</Banner>
          <Banner variant="success">Profile saved.</Banner>
          <Banner variant="warning" dismissible>Demo mode — analytics derived from simulated sessions.</Banner>
          <Banner variant="danger" dismissible>Session ended early. Some metrics may be incomplete.</Banner>
        </div>
      </Section>

      {/* DATA */}
      <Section title="Data display" topRule>
        <div className="grid-3">
          <StatCard label="Sessions" value={14} delta={+3} hint="vs last week" />
          <StatCard label="Avg quality" value="74" unit="%" delta={+2} mono />
          <StatCard label="Composite" value="76" delta={-1} hint="last 10 sessions" />
        </div>
        <div className="grid-2" style={{ marginTop: 16 }}>
          <Card>
            <div className="t-over" style={{ marginBottom: 12 }}>OCEAN snapshot</div>
            <div className="col" style={{ gap: 12 }}>
              {TRAITS.map((t) => (
                <ScoreBarRow key={t.letter} {...t} />
              ))}
            </div>
          </Card>
          <Card>
            <div className="t-over" style={{ marginBottom: 12 }}>Charts</div>
            <RadarChart data={RADAR_DATA} size={240} />
          </Card>
        </div>
        <div className="grid-2" style={{ marginTop: 16 }}>
          <Card>
            <div className="t-over" style={{ marginBottom: 12 }}>Progress trend</div>
            <LineChart data={LINE_DATA} />
          </Card>
          <Card>
            <div className="t-over" style={{ marginBottom: 12 }}>Bar chart</div>
            <BarChart
              data={[
                { label: 'M', value: 45 },
                { label: 'T', value: 70 },
                { label: 'W', value: 62 },
                { label: 'T', value: 78 },
                { label: 'F', value: 84 },
              ]}
            />
          </Card>
        </div>
        <div className="row" style={{ marginTop: 16, gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <RadialScore value={71} label="Confidence" sub="HIGH" />
          <RadialScore value={34} label="Stress" sub="LOW" color="var(--success)" />
          <div style={{ flex: 1, minWidth: 240 }}>
            <DistributionStrip
              segments={[
                { label: 'Reflective', value: 38 },
                { label: 'Calm', value: 31 },
                { label: 'Determined', value: 19 },
                { label: 'Other', value: 12 },
              ]}
            />
          </div>
          <div>
            <span className="t-cap" style={{ marginRight: 6 }}>Animated:</span>
            <CountUp className="score-num fg" to={76} />
          </div>
        </div>
      </Section>

      {/* NAV / OVERLAYS */}
      <Section title="Navigation & disclosure" topRule>
        <Card>
          <TabNav
            value={tab}
            onChange={setTab}
            options={[
              { label: 'Overview', value: 'overview' },
              { label: 'Coaching', value: 'coaching' },
              { label: 'Risk', value: 'risk' },
              { label: 'Charts', value: 'charts' },
            ]}
          />
          <div style={{ marginTop: 16 }}>
            <AccordionItem
              title="Hold the first counter for one more exchange"
              subtitle="Across 4 of 5 sessions you've accepted the first counter at turn 5."
              badge={<Badge variant="danger">Critical</Badge>}
              defaultOpen
            >
              <p className="t-body" style={{ color: 'var(--text-secondary)' }}>
                When trust is climbing, the next concession is usually within reach.
              </p>
            </AccordionItem>
            <AccordionItem
              title="Open with structure before salary"
              subtitle="Sessions where you anchored on scope first closed with trust ≥ 75."
              badge={<Badge variant="warning">Important</Badge>}
            >
              <p className="t-body" style={{ color: 'var(--text-secondary)' }}>
                Scope anchoring gives the manager material to work with that isn't budget.
              </p>
            </AccordionItem>
          </div>
        </Card>
        <div style={{ marginTop: 16 }}>
          <Card>
            <KeyValuePair k="Strategy" v="Patient, structure-forward" />
            <KeyValuePair k="Pacing" v="Measured" mono />
            <KeyValuePair k="Difficulty" v="7 / 10" mono />
            <KeyValuePair k="Last updated" v="12m ago" />
          </Card>
        </div>
      </Section>

      <Section title="Confirmation example" topRule>
        <Card variant="accent">
          <div className="row" style={{ alignItems: 'center', gap: 12 }}>
            <CheckCircle2 size={20} style={{ color: 'var(--success)' }} />
            <div>
              <div className="t-h3">Email verified</div>
              <div className="t-cap">You can now sign in to continue training.</div>
            </div>
            <div style={{ flex: 1 }} />
            <Mic size={16} style={{ color: 'var(--text-tertiary)' }} />
          </div>
        </Card>
      </Section>
    </div>
  );
}
