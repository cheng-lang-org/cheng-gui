import { isPublishLocationError, type PublishLocationErrorCode } from '../data/distributedContent';
import type { Translations } from '../i18n/translations';

export function getPublishLocationErrorCode(error: unknown): PublishLocationErrorCode | null {
  if (!isPublishLocationError(error)) {
    return null;
  }
  return error.code;
}

export function getPublishLocationErrorMessage(t: Translations, error: unknown): string {
  const code = getPublishLocationErrorCode(error);
  if (code === 'permission_denied') {
    return t.publish_location_error_permissionDenied;
  }
  if (code === 'accuracy_too_low') {
    return t.publish_location_error_accuracyTooLow;
  }
  if (code === 'timeout') {
    return t.publish_location_error_timeout;
  }
  if (code === 'unavailable') {
    return t.publish_location_error_unavailable;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return t.publish_location_error_unknown;
}
