import React from 'react';
import {render} from '@testing-library/react-native';
import LocationPickerScreen from './LocationPickerScreen';

jest.mock('../config/environment', () => ({MAPS_PROVIDER: 'google'}));
jest.mock('@react-native-community/geolocation', () => ({getCurrentPosition: jest.fn()}));
jest.mock('react-native-maps', () => {
  const ReactForMock = require('react');
  const {View: RNView} = require('react-native');
  return {
    __esModule: true,
    default: (props: object) => ReactForMock.createElement(RNView, {...props, testID: 'map-view'}),
    Marker: (props: object) => ReactForMock.createElement(RNView, {...props, testID: 'map-marker'}),
  };
});

test('LocationPickerScreen renders map cleanly without mock artifacts', async () => {
  const view = await render(<LocationPickerScreen accessToken="token" onBack={jest.fn()} onUseLocation={jest.fn()} />);
  expect(JSON.stringify(view.toJSON())).not.toContain('development_mock');
  expect(view.queryByText(/Source:|Provider:/)).toBeNull();
  expect(view.getByTestId('map-view')).toBeTruthy();
});
