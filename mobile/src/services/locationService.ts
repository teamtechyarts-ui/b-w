import type {
  SelectedLocation,
} from '../types/location';

/**
 * Default location center (Hyderabad) used as initial fallback before GPS resolution.
 */
const DEFAULT_LOCATION: SelectedLocation = {
  coordinates: {
    latitude: 17.385,
    longitude: 78.4867,
  },

  formattedAddress:
    'Banjara Hills, Hyderabad, Telangana 500034',

  addressLine1:
    'Banjara Hills',

  addressLine2:
    'Hyderabad',

  city:
    'Hyderabad',

  state:
    'Telangana',

  postalCode:
    '500034',

  placeId:
    null,

  source:
    'default',
};

export function getDefaultLocation():
  SelectedLocation {
  return {
    ...DEFAULT_LOCATION,

    coordinates: {
      ...DEFAULT_LOCATION.coordinates,
    },
  };
}
