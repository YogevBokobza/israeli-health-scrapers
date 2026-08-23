import type { HealthFundId } from '../../src/definitions.js';
import {
  maccabiAppointmentBindingDefinition,
  maccabiAppointmentDetailBindingDefinition,
  maccabiLoginBindingDefinition,
  maccabiForm17BindingDefinition,
  maccabiMedicationBindingDefinition,
  maccabiVaccinationBindingDefinition,
} from '../../src/scrapers/maccabi.js';
import type { TargetBindingDefinition } from './binding-resolver.js';
import type { ManifestEntry } from './manifest.js';

function eraseResultType<TResult>(
  definition: TargetBindingDefinition<TResult>,
): TargetBindingDefinition<unknown> {
  return {
    bindings: definition.bindings.map((binding) => ({
      field: binding.field,
      selector: binding.selector,
      valueFromResult: (result) => binding.valueFromResult(result as TResult),
    })),
    parse: definition.parse,
  };
}

const maccabiBindings: Record<string, TargetBindingDefinition<unknown>> = {
  login: eraseResultType(maccabiLoginBindingDefinition),
  medications: eraseResultType(maccabiMedicationBindingDefinition),
  appointments: eraseResultType(maccabiAppointmentBindingDefinition),
  vaccinations: eraseResultType(maccabiVaccinationBindingDefinition),
  form17: eraseResultType(maccabiForm17BindingDefinition),
  // Read through the page's own JSON API rather than the DOM (see maccabi.ts), so there
  // is no rendered element for the capture tool to bind a selector to.
  testResults: {
    bindings: [],
    parse: async () => ({ status: 'not-dom-bound' }),
  },
  testResultDetails: {
    bindings: [],
    parse: async () => ({ status: 'not-dom-bound' }),
  },
  pastVisits: {
    bindings: [],
    parse: async () => ({ status: 'not-dom-bound' }),
  },
  messages: {
    bindings: [],
    parse: async () => ({ status: 'not-implemented' }),
  },
};

/** Selects current fund code for a captured step; an absent definition renders pending. */
export function bindingDefinitionFor(
  fund: HealthFundId,
  entry: ManifestEntry,
): TargetBindingDefinition<unknown> | undefined {
  if (fund !== 'maccabi') return undefined;
  if (entry.target === 'appointments' && entry.state.trim().toLowerCase() === 'detail') {
    return eraseResultType(maccabiAppointmentDetailBindingDefinition);
  }
  return maccabiBindings[entry.target];
}
