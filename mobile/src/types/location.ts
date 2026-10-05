export type LocationCoordinates = {
  latitude: number;
  longitude: number;
  accuracy?: number;
};

export type SelectedLocation = {
  coordinates: LocationCoordinates;

  formattedAddress: string;

  addressLine1: string;
  addressLine2: string;

  city: string;
  state: string;
  postalCode: string;

  placeId: string | null;

  source:
    | 'default'
    | 'google_maps'
    | 'device_location';
};
