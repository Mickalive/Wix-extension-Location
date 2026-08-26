/**
 * Platform registration surface (INT-C6-R1; Blueprint §1
 * `platform/registration/` — extension configs, project binding, scaffold
 * prerequisites). Pure, Wix-import-free modules: the real generated artifacts
 * (wix.config.json, generated extensions.ts entries, dashboard-configured
 * subscriptions) come into existence only at the authenticated scaffold
 * (gate T-VP0, Technical Contract §15/§16). See ./README.md.
 */
export {
  PROJECT_CONFIG_FILENAME,
  classifyProjectBinding,
  looksLikeScaffoldPlaceholder,
} from './projectConfig';
export type { ProjectLinkage, RawProjectConfig } from './projectConfig';
export {
  EXAMPLE_PROJECT_CONFIG,
  EXAMPLE_PROJECT_CONFIG_FILENAME,
  SCAFFOLD_PLACEHOLDER_APP_ID,
  exampleProjectConfigIsUnlinkedByConstruction,
  serializeExampleProjectConfig,
} from './exampleProjectConfig';
export {
  BOOKINGS_VALIDATION_CATALOG_NAME,
  BOOKINGS_VALIDATION_EXTENSION_KIND,
  DEFAULT_VALIDATION_DEPLOYMENT_URI,
  buildBookingsValidationExtensionConfig,
  validateDeploymentUri,
} from './validationExtension';
export type { BookingsValidationExtensionConfig } from './validationExtension';
export {
  EXTENSION_REGISTRATIONS,
  extensionRegistrationsByChannel,
} from './extensionsManifest';
export type {
  ExtensionKind,
  ExtensionRegistration,
  ExtensionRegistrationStatus,
  RegistrationChannel,
} from './extensionsManifest';
export {
  PROJECT_CONFIG_FILE,
  SCAFFOLD_COMMAND,
  SCAFFOLD_PREREQUISITES,
  externalBlockerStatement,
} from './scaffoldPrerequisites';
export type { PrerequisiteOwner, ScaffoldPrerequisite } from './scaffoldPrerequisites';
