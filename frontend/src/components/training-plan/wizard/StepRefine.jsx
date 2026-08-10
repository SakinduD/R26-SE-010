import React from 'react'
import { Loader2 } from 'lucide-react'
import Card from '@/components/ui/Card'
import TextInput from '@/components/ui/TextInput'
import SegmentedControl from '@/components/ui/SegmentedControl'
import ChipToggle from '@/components/ui/ChipToggle'
import Banner from '@/components/ui/Banner'
import {
  DISPOSITION_LABEL,
  DOMAIN_LABEL,
  INTENSITY_LABEL,
  SESSION_LENGTH_HINT,
  SESSION_LENGTH_LABEL,
  humanise,
} from '../constants'
import {
  DISPOSITION_VALUES,
  DOMAIN_VALUES,
  INTENSITY_VALUES,
  SESSION_LENGTH_VALUES,
} from '@/lib/validation/trainingPlan'

const INFER_HINT = "Leave blank and we'll infer it from your goal and personality profile."

function Select({ id, label, value, onChange, options, labelMap, placeholder }) {
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <select
        id={id}
        name={id}
        className="input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        style={{ cursor: 'pointer' }}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {labelMap?.[opt] ?? humanise(opt)}
          </option>
        ))}
      </select>
    </div>
  )
}

function OptionalSegmented({ id, label, value, onChange, values, labelMap, hintMap }) {
  const options = values.map((v) => ({ label: labelMap?.[v] ?? humanise(v), value: v }))
  const labelId = `${id}-label`
  return (
    <div className="field">
      <div className="field-label" id={labelId}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <SegmentedControl
          options={options}
          value={value ?? ''}
          onChange={onChange}
          aria-labelledby={labelId}
        />
        {value && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onChange('')}
          >
            <span className="btn-label">Clear</span>
          </button>
        )}
      </div>
      <span className="field-helper">
        {value && hintMap?.[value] ? hintMap[value] : INFER_HINT}
      </span>
    </div>
  )
}

function SkillMultiSelect({ skills, selected, onToggle, loading, error, allowedSkills }) {
  return (
    <div className="field">
      <div className="field-label" id="focus-skills-label">
        Focus skills
      </div>

      {loading ? (
        <div
          className="t-cap"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}
        >
          <Loader2 size={13} strokeWidth={1.6} className="animate-spin" />
          Loading skills…
        </div>
      ) : skills.length === 0 ? (
        <span className="field-helper">
          Skill list unavailable right now — we'll pick focus skills from your profile.
        </span>
      ) : (
        <div
          role="group"
          aria-labelledby="focus-skills-label"
          aria-describedby="focus-skills-help"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
        >
          {skills.map((skill) => (
            <ChipToggle
              key={skill}
              active={selected.includes(skill)}
              onClick={() => onToggle(skill)}
            >
              {humanise(skill)}
            </ChipToggle>
          ))}
        </div>
      )}

      {error ? (
        <span role="alert" className="field-error">
          {error}
          {allowedSkills?.length > 0 && (
            <>
              {' '}
              Allowed values: {allowedSkills.map(humanise).join(', ')}.
            </>
          )}
        </span>
      ) : (
        <span id="focus-skills-help" className="field-helper">
          {selected.length > 0
            ? `${selected.length} selected · tap again to remove`
            : INFER_HINT}
        </span>
      )}
    </div>
  )
}

export default function StepRefine({
  values,
  setValue,
  skills,
  skillsLoading,
  vocabularyError,
  focusSkillsError,
  allowedSkills,
  headingRef,
}) {
  const toggleSkill = (skill) => {
    const current = values.focus_skills ?? []
    setValue(
      'focus_skills',
      current.includes(skill) ? current.filter((s) => s !== skill) : [...current, skill],
    )
  }

  return (
    <Card>
      <h2 ref={headingRef} tabIndex={-1} className="t-h2" style={{ margin: 0, outline: 'none' }}>
        Refine <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span>
      </h2>
      <p className="t-cap" style={{ marginTop: 6, marginBottom: 18, lineHeight: 1.55 }}>
        Every field here is optional. Leave anything blank and we'll infer it from your goal and
        personality profile — you can always regenerate later.
      </p>

      {vocabularyError && (
        <div style={{ marginBottom: 16 }}>
          <Banner variant="warning">{vocabularyError}</Banner>
        </div>
      )}

      <div className="col" style={{ gap: 16 }}>
        <Select
          id="domain"
          label="Type of conversation"
          value={values.domain}
          onChange={(v) => setValue('domain', v)}
          options={DOMAIN_VALUES}
          labelMap={DOMAIN_LABEL}
          placeholder="Infer from my goal"
        />

        <TextInput
          name="workplace_context"
          label="Setting"
          placeholder="e.g. sprint retro on a 6-person dev team"
          helper={INFER_HINT}
          value={values.workplace_context ?? ''}
          onChange={(e) => setValue('workplace_context', e.target.value)}
          maxLength={300}
        />

        <div className="grid-2" style={{ gap: 16 }}>
          <TextInput
            name="learner_role"
            label="Your role"
            placeholder="e.g. senior engineer"
            value={values.learner_role ?? ''}
            onChange={(e) => setValue('learner_role', e.target.value)}
            maxLength={120}
          />
          <TextInput
            name="counterpart_role"
            label="Their role"
            placeholder="e.g. engineering manager"
            value={values.counterpart_role ?? ''}
            onChange={(e) => setValue('counterpart_role', e.target.value)}
            maxLength={120}
          />
        </div>

        <Select
          id="counterpart_disposition"
          label="How are they likely to react?"
          value={values.counterpart_disposition}
          onChange={(v) => setValue('counterpart_disposition', v)}
          options={DISPOSITION_VALUES}
          labelMap={DISPOSITION_LABEL}
          placeholder="Infer from my goal"
        />

        <OptionalSegmented
          id="intensity"
          label="Intensity"
          value={values.intensity_preference}
          onChange={(v) => setValue('intensity_preference', v)}
          values={INTENSITY_VALUES}
          labelMap={INTENSITY_LABEL}
        />

        <OptionalSegmented
          id="session-length"
          label="Session length"
          value={values.session_length}
          onChange={(v) => setValue('session_length', v)}
          values={SESSION_LENGTH_VALUES}
          labelMap={SESSION_LENGTH_LABEL}
          hintMap={SESSION_LENGTH_HINT}
        />

        <SkillMultiSelect
          skills={skills}
          selected={values.focus_skills ?? []}
          onToggle={toggleSkill}
          loading={skillsLoading}
          error={focusSkillsError}
          allowedSkills={allowedSkills}
        />
      </div>
    </Card>
  )
}
