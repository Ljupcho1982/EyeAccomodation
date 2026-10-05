// User profile -> navigation settings.
//
// Diopters are deliberately NOT used: they describe the refractive error that
// glasses correct, not how a person moves through a room. The profile uses
// functional parameters instead: corrected visual acuity, visual field,
// light perception, and (for wheelchair users) the real chair dimensions.

export const PRESETS = {
  blind: { lightPerception: 'none', acuity: 0, fieldLoss: 'none', wheelchair: false },
  lowvision: { lightPerception: 'normal', acuity: 0.15, fieldLoss: 'none', wheelchair: false },
  wheelchair: { lightPerception: 'normal', acuity: 1, fieldLoss: 'none', wheelchair: true },
  combined: { lightPerception: 'normal', acuity: 0.15, fieldLoss: 'none', wheelchair: true },
};

const PRESET_CLASS = { blind: 'none', lowvision: 'low', wheelchair: 'normal', combined: 'low' };
const RANK = { none: 0, low: 1, normal: 2 };

export const FIELD_LOSS = ['none', 'tunnel', 'left', 'right', 'central'];
export const LIGHT = ['normal', 'light-only', 'none'];

// Thresholds are defaults to be validated with O&M instructors. 0.05 is the
// WHO blindness limit (3/60); 0.3 is the WHO low-vision limit (6/18).
export function visionClass({ acuity, fieldLoss, lightPerception }) {
  if (lightPerception === 'none' || acuity < 0.05) return 'none';
  if (acuity < 0.3 || fieldLoss !== 'none' || lightPerception === 'light-only') return 'low';
  return 'normal';
}

function clamp(v, lo, hi, name, warnings) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    warnings.push({ code: 'invalid', field: name });
    return lo;
  }
  if (n < lo || n > hi) warnings.push({ code: 'clamped', field: name, lo, hi });
  return Math.min(hi, Math.max(lo, n));
}

export function makeProfile(input = {}) {
  const warnings = [];
  const preset = PRESETS[input.preset] ? input.preset : 'lowvision';
  const base = PRESETS[preset];
  const p = {
    preset,
    acuity: clamp(input.acuity ?? base.acuity, 0, 1.2, 'acuity', warnings),
    fieldLoss: FIELD_LOSS.includes(input.fieldLoss) ? input.fieldLoss : base.fieldLoss,
    lightPerception: LIGHT.includes(input.lightPerception) ? input.lightPerception : base.lightPerception,
    mobility: {
      wheelchair: input.wheelchair ?? base.wheelchair,
      // Below 60 cm the chair cannot physically fit the narrowest passage we avoid.
      widthCm: clamp(input.widthCm ?? 65, 60, 120, 'widthCm', warnings),
      maxThresholdCm: clamp(input.maxThresholdCm ?? 2, 0, 8, 'maxThresholdCm', warnings),
    },
    approvedBy: input.approvedBy === 'professional' ? 'professional' : 'self',
    lang: input.lang === 'en' ? 'en' : 'mk',
  };

  // Safety: if the declared preset is more restrictive than the numbers, trust the preset.
  const fromParams = visionClass(p);
  const fromPreset = PRESET_CLASS[preset];
  p.effectiveClass = RANK[fromPreset] < RANK[fromParams] ? fromPreset : fromParams;
  if (p.effectiveClass !== fromParams) warnings.push({ code: 'preset_conflict', preset, fromParams });
  if (p.approvedBy === 'self') warnings.push({ code: 'unverified' });
  return { profile: p, warnings };
}

export function deriveSettings(profile) {
  const cls = profile.effectiveClass;
  const wheel = profile.mobility.wheelchair;
  let margin = 5;
  if (cls === 'none') margin += 5; // cane sweep / no visual correction of path
  if (profile.fieldLoss !== 'none') margin += 5; // obstacles appear late from the sides
  return {
    visionClass: cls,
    wheelchair: wheel,
    halfWidthCm: (wheel ? profile.mobility.widthCm : 45) / 2,
    marginCm: margin,
    maxStepCm: wheel ? profile.mobility.maxThresholdCm : 2,
    screen: cls !== 'none',
    highContrast: cls === 'low',
    fontScale: cls === 'low' ? 1.6 : 1,
    lang: profile.lang,
  };
}
