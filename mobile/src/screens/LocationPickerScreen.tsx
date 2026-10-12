import React, {
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import AppIcon from '../components/AppIcon';


import {
  getPlaceDetails,
  reverseGeocode,
  searchPlaces,
} from '../services/mapsApi';

import {
  getDefaultLocation,
} from '../services/locationService';

import {
  getCurrentDeviceLocation,
} from '../services/deviceLocationService';

import type {
  PlaceSearchResult,
  ResolvedPlace,
} from '../services/mapsApi';

import type {
  SelectedLocation,
} from '../types/location';

import MapView, { Marker } from 'react-native-maps';

const NativeMapView = MapView;
const NativeMarker = Marker;


type LocationPickerScreenProps = {
  accessToken: string;

  onBack: () => void;

  onUseLocation: (
    location: SelectedLocation,
  ) => void;
};

const DEFAULT_LATITUDE_DELTA =
  0.015;

const DEFAULT_LONGITUDE_DELTA =
  0.015;

function toSelectedLocation(
  place: ResolvedPlace,
): SelectedLocation {
  return {
    coordinates: {
      latitude:
        place.coordinate.latitude,

      longitude:
        place.coordinate.longitude,
    },

    formattedAddress:
      place.formattedAddress,

    addressLine1:
      place.addressLine1,

    addressLine2:
      place.addressLine2,

    city:
      place.city,

    state:
      place.state,

    postalCode:
      place.postalCode,

    placeId:
      place.placeId,

    source:
      'google_maps',
  };

}

export default function LocationPickerScreen({
  accessToken,
  onBack,
  onUseLocation,
}: LocationPickerScreenProps) {
  const mapRef =
    useRef<MapView | null>(
      null,
    );

  const initialLocation =
    useMemo(
      () =>
        getDefaultLocation(),
      [],
    );

  const [
    selectedLocation,
    setSelectedLocation,
  ] =
    useState<SelectedLocation>(
      initialLocation,
    );

  const [
    searchQuery,
    setSearchQuery,
  ] =
    useState('');

  const [
    searchResults,
    setSearchResults,
  ] =
    useState<
      PlaceSearchResult[]
    >([]);

  const [
    searching,
    setSearching,
  ] =
    useState(false);

  const [
    resolvingPlace,
    setResolvingPlace,
  ] =
    useState(false);

  const [
    reverseGeocoding,
    setReverseGeocoding,
  ] =
    useState(false);

  const [
    locating,
    setLocating,
  ] =
    useState(false);

  const busy =
    searching ||
    resolvingPlace ||
    reverseGeocoding ||
    locating;

  const animateMapToLocation =
    (
      latitude: number,
      longitude: number,
    ) => {
      mapRef.current?.animateToRegion(
        {
          latitude,
          longitude,
          latitudeDelta:
            DEFAULT_LATITUDE_DELTA,
          longitudeDelta:
            DEFAULT_LONGITUDE_DELTA,
        },
        400,
      );
    };

  const resolveCoordinates =
    async (
      latitude: number,
      longitude: number,
      sourceOverride?:
        SelectedLocation['source'],
    ) => {
      try {
        setReverseGeocoding(
          true,
        );

        const result =
          await reverseGeocode(
            accessToken,
            latitude,
            longitude,
          );

        const location =
          toSelectedLocation(
            result,
          );

        if (
          sourceOverride
        ) {
          location.source =
            sourceOverride;
        }

        setSelectedLocation(
          location,
        );

        animateMapToLocation(
          latitude,
          longitude,
        );
      } catch (
        error: unknown
      ) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to resolve this location';

        Alert.alert(
          'Location Error',
          message,
        );
      } finally {
        setReverseGeocoding(
          false,
        );
      }
    };

  const runSearch =
    async () => {
      const normalizedQuery =
        searchQuery.trim();

      if (
        normalizedQuery.length <
        2
      ) {
        Alert.alert(
          'Search',
          'Please enter at least 2 characters.',
        );

        return;
      }

      try {
        setSearching(
          true,
        );

        const results =
          await searchPlaces(
            accessToken,
            normalizedQuery,
          );

        setSearchResults(
          results,
        );

        if (
          results.length ===
          0
        ) {
          Alert.alert(
            'No locations found',
            'Try another search.',
          );
        }
      } catch (
        error: unknown
      ) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to search locations';

        Alert.alert(
          'Location Search Error',
          message,
        );
      } finally {
        setSearching(
          false,
        );
      }
    };

  const chooseSearchResult =
    async (
      result:
        PlaceSearchResult,
    ) => {
      try {
        setResolvingPlace(
          true,
        );

        const place =
          await getPlaceDetails(
            accessToken,
            result.placeId,
          );

        const location =
          toSelectedLocation(
            place,
          );

        setSelectedLocation(
          location,
        );

        setSearchQuery(
          result.formattedText,
        );

        setSearchResults(
          [],
        );

        animateMapToLocation(
          location.coordinates
            .latitude,

          location.coordinates
            .longitude,
        );
      } catch (
        error: unknown
      ) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to load location details';

        Alert.alert(
          'Location Error',
          message,
        );
      } finally {
        setResolvingPlace(
          false,
        );
      }
    };

  const useCurrentLocation =
    async () => {
      try {
        setLocating(
          true,
        );

        const location =
          await getCurrentDeviceLocation();

        animateMapToLocation(
          location.latitude,
          location.longitude,
        );

        await resolveCoordinates(
          location.latitude,
          location.longitude,
          'device_location',
        );
      } catch (
        error: unknown
      ) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to determine current location';

        Alert.alert(
          'Current Location',
          message,
        );
      } finally {
        setLocating(
          false,
        );
      }
    };

  const {
    coordinates,
  } =
    selectedLocation;

  return (
    <SafeAreaView
      style={
        styles.container
      }>
      <StatusBar
        barStyle="dark-content"
      />

      <View
        style={
          styles.screenContainer
        }>
        <View
          style={
            styles.pageHeader
          }>
          <TouchableOpacity
            disabled={
              busy
            }
            onPress={
              onBack
            }>
            <Text
              style={
                styles.pageBack
              }>
              ← Back
            </Text>
          </TouchableOpacity>

          <Text
            style={
              styles.pageHeaderTitle
            }>
            Choose Location
          </Text>

          <View
            style={
              styles.headerSpacer
            }
          />
        </View>

        <ScrollView
          style={
            styles.flex
          }
          contentContainerStyle={
            styles.scrollContent
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={
            false
          }>
          <View
            style={
              styles.developmentBanner
            }>
            <Text
              style={
                styles.developmentBannerTitle
              }>
              CHOOSE YOUR PICKUP POINT
            </Text>

            <Text
              style={
                styles.developmentBannerText
              }>
              Search for an address or place the pin at the
              exact entrance where we should collect your laundry.
            </Text>
          </View>

          <Text
            style={
              styles.sectionTitle
            }>
            Search Location
          </Text>

          <View
            style={
              styles.searchRow
            }>
            <TextInput
              style={
                styles.searchInput
              }
              placeholder="Search area, landmark or address"
              value={
                searchQuery
              }
              editable={
                !busy
              }
              returnKeyType="search"
              onChangeText={
                value => {
                  setSearchQuery(
                    value,
                  );

                  if (
                    value.trim()
                      .length <
                    2
                  ) {
                    setSearchResults(
                      [],
                    );
                  }
                }
              }
              onSubmitEditing={
                runSearch
              }
            />

            <TouchableOpacity
              style={[
                styles.searchButton,

                searching &&
                  styles.buttonDisabled,
              ]}
              disabled={
                searching
              }
              onPress={
                runSearch
              }>
              {searching ? (
                <ActivityIndicator
                  color="#FFFFFF"
                  size="small"
                />
              ) : (
                <Text
                  style={
                    styles.searchButtonText
                  }>
                  Search
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {searchResults.length >
          0 ? (
            <View
              style={
                styles.searchResultsCard
              }>
              {searchResults.map(
                result => (
                  <TouchableOpacity
                    key={
                      result.placeId
                    }
                    style={
                      styles.searchResult
                    }
                    disabled={
                      resolvingPlace
                    }
                    onPress={() =>
                      chooseSearchResult(
                        result,
                      )
                    }>
                    <Text
                      style={
                        styles.searchResultTitle
                      }>
                      {
                        result.primaryText
                      }
                    </Text>

                    {result.secondaryText ? (
                      <Text
                        style={
                          styles.searchResultSubtitle
                        }>
                        {
                          result.secondaryText
                        }
                      </Text>
                    ) : null}


                  </TouchableOpacity>
                ),
              )}
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.currentLocationButton,

              locating &&
                styles.buttonDisabled,
            ]}
            disabled={
              busy
            }
            onPress={
              useCurrentLocation
            }>
            {locating ? (
              <ActivityIndicator
                size="small"
                color="#111111"
              />
            ) : (
              <Text
                style={
                  styles.currentLocationButtonText
                }>
                ◎ Use Current Location
              </Text>
            )}
          </TouchableOpacity>

          <Text
            style={
              styles.sectionTitle
            }>
            Select Exact Location
          </Text>

          <View
            style={
              styles.mapContainer
            }>
            {NativeMapView && NativeMarker ? (
            <NativeMapView
              ref={
                mapRef
              }
              style={
                styles.map
              }
              initialRegion={{
                latitude:
                  coordinates.latitude,

                longitude:
                  coordinates.longitude,

                latitudeDelta:
                  DEFAULT_LATITUDE_DELTA,

                longitudeDelta:
                  DEFAULT_LONGITUDE_DELTA,
              }}
              showsCompass
              showsScale
              toolbarEnabled={
                false
              }
              onPress={
                event => {
                  const {
                    latitude,
                    longitude,
                  } =
                    event
                      .nativeEvent
                      .coordinate;

                  resolveCoordinates(
                    latitude,
                    longitude,
                  );
                }
              }>
              <NativeMarker
                coordinate={{
                  latitude:
                    coordinates.latitude,

                  longitude:
                    coordinates.longitude,
                }}
                draggable
                onDragEnd={
                  event => {
                    const {
                      latitude,
                      longitude,
                    } =
                      event
                        .nativeEvent
                        .coordinate;

                    resolveCoordinates(
                      latitude,
                      longitude,
                    );
                  }
                }
              />
            </NativeMapView>
            ) : (
              <View style={styles.mapFallbackContainer}>
                <Text style={styles.mapFallbackText}>
                  Interactive map is unavailable on this platform. Search an address above or use Current Location.
                </Text>
              </View>
            )}

            {reverseGeocoding ? (
              <View
                style={
                  styles.mapLoadingOverlay
                }>
                <ActivityIndicator
                  size="large"
                  color="#111111"
                />

                <Text
                  style={
                    styles.mapLoadingText
                  }>
                  Resolving address...
                </Text>
              </View>
            ) : null}
          </View>

          <Text
            style={
              styles.mapHelpText
            }>
            Tap the map or drag the pin to set the exact pickup location.
          </Text>


          <Text
            style={
              styles.sectionTitle
            }>
            Selected Location
          </Text>

          <View
            style={
              styles.locationCard
            }>
            <View
              style={
                styles.locationIconContainer
              }>
              <AppIcon name="location" size={20} color="#111827" />
            </View>

            <View
              style={
                styles.locationDetails
              }>
              <Text
                style={
                  styles.locationAddress
                }>
                {
                  selectedLocation
                    .formattedAddress
                }
              </Text>

              <Text
                style={
                  styles.locationCoordinates
                }>
                Latitude:{' '}
                {
                  coordinates.latitude
                }
              </Text>

              <Text
                style={
                  styles.locationCoordinates
                }>
                Longitude:{' '}
                {
                  coordinates.longitude
                }
              </Text>


            </View>
          </View>

          <View
            style={
              styles.addressDetailsCard
            }>
            <Text
              style={
                styles.addressDetailsTitle
              }>
              Address Details
            </Text>

            <View
              style={
                styles.detailRow
              }>
              <Text
                style={
                  styles.detailLabel
                }>
                Address
              </Text>

              <Text
                style={
                  styles.detailValue
                }>
                {
                  selectedLocation.addressLine1 ||
                  '-'
                }
              </Text>
            </View>

            <View
              style={
                styles.detailRow
              }>
              <Text
                style={
                  styles.detailLabel
                }>
                Area
              </Text>

              <Text
                style={
                  styles.detailValue
                }>
                {
                  selectedLocation.addressLine2 ||
                  '-'
                }
              </Text>
            </View>

            <View
              style={
                styles.detailRow
              }>
              <Text
                style={
                  styles.detailLabel
                }>
                City
              </Text>

              <Text
                style={
                  styles.detailValue
                }>
                {
                  selectedLocation.city ||
                  '-'
                }
              </Text>
            </View>

            <View
              style={
                styles.detailRow
              }>
              <Text
                style={
                  styles.detailLabel
                }>
                State
              </Text>

              <Text
                style={
                  styles.detailValue
                }>
                {
                  selectedLocation.state ||
                  '-'
                }
              </Text>
            </View>

            <View
              style={[
                styles.detailRow,
                styles.lastDetailRow,
              ]}>
              <Text
                style={
                  styles.detailLabel
                }>
                Postal Code
              </Text>

              <Text
                style={
                  styles.detailValue
                }>
                {
                  selectedLocation.postalCode ||
                  '-'
                }
              </Text>
            </View>
          </View>
        </ScrollView>

        <View
          style={
            styles.bottomArea
          }>
          <TouchableOpacity
            style={[
              styles.useLocationButton,

              busy &&
                styles.buttonDisabled,
            ]}
            disabled={
              busy
            }
            onPress={() =>
              onUseLocation(
                selectedLocation,
              )
            }>
            <Text
              style={
                styles.useLocationButtonText
              }>
              Use This Location
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles =
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        '#FFFFFF',
    },

    flex: {
      flex: 1,
    },

    screenContainer: {
      flex: 1,
      paddingHorizontal:
        20,
    },

    pageHeader: {
      height: 65,
      flexDirection:
        'row',
      alignItems:
        'center',
      justifyContent:
        'space-between',
    },

    pageBack: {
      minWidth: 60,
      fontSize: 15,
      fontWeight:
        '600',
      color:
        '#111111',
    },

    pageHeaderTitle: {
      flex: 1,
      textAlign:
        'center',
      fontSize: 18,
      fontWeight:
        '700',
      color:
        '#111111',
      marginHorizontal:
        8,
    },

    headerSpacer: {
      width: 60,
    },

    scrollContent: {
      paddingBottom:
        140,
    },

    developmentBanner: {
      backgroundColor:
        '#F5F5F5',
      borderRadius: 14,
      padding: 15,
      marginBottom: 18,
    },

    developmentBannerTitle: {
      fontSize: 10,
      fontWeight:
        '800',
      letterSpacing: 0.5,
      color:
        '#111111',
    },

    developmentBannerText: {
      marginTop: 6,
      fontSize: 11,
      lineHeight: 17,
      color:
        '#666666',
    },

    sectionTitle: {
      fontSize: 17,
      fontWeight:
        '700',
      marginBottom: 10,
      color:
        '#111111',
    },

    searchRow: {
      flexDirection:
        'row',
      marginBottom: 10,
    },

    searchInput: {
      flex: 1,
      minHeight: 48,
      borderWidth: 1,
      borderColor:
        '#D8D8D8',
      borderRadius: 12,
      paddingHorizontal: 13,
      fontSize: 14,
      color:
        '#111111',
      marginRight: 8,
    },

    searchButton: {
      minWidth: 78,
      minHeight: 48,
      borderRadius: 12,
      backgroundColor:
        '#111111',
      alignItems:
        'center',
      justifyContent:
        'center',
      paddingHorizontal: 12,
    },

    searchButtonText: {
      color:
        '#FFFFFF',
      fontSize: 13,
      fontWeight:
        '700',
    },

    searchResultsCard: {
      borderWidth: 1,
      borderColor:
        '#E5E5E5',
      borderRadius: 14,
      overflow:
        'hidden',
      marginBottom: 18,
    },

    searchResult: {
      padding: 14,
      borderBottomWidth: 1,
      borderBottomColor:
        '#EEEEEE',
    },

    searchResultTitle: {
      fontSize: 14,
      fontWeight:
        '700',
      color:
        '#111111',
    },

    searchResultSubtitle: {
      marginTop: 3,
      fontSize: 11,
      lineHeight: 16,
      color:
        '#666666',
    },

    searchResultProvider: {
      marginTop: 4,
      fontSize: 9,
      color:
        '#999999',
    },

    currentLocationButton: {
      minHeight: 48,
      borderWidth: 1,
      borderColor:
        '#CCCCCC',
      borderRadius: 12,
      alignItems:
        'center',
      justifyContent:
        'center',
      marginBottom: 20,
      backgroundColor:
        '#FFFFFF',
    },

    currentLocationButtonText: {
      fontSize: 13,
      fontWeight:
        '700',
      color:
        '#111111',
    },

    mapContainer: {
      height: 320,
      borderRadius: 18,
      overflow:
        'hidden',
      backgroundColor:
        '#F2F2F2',
      marginBottom: 8,
    },

    map: {
      ...StyleSheet.absoluteFill,
    },

    mapFallbackContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      backgroundColor: '#F7F7F7',
    },

    mapFallbackText: {
      fontSize: 13,
      color: '#666666',
      textAlign: 'center',
      lineHeight: 18,
    },

    mapLoadingOverlay: {
      ...StyleSheet.absoluteFill,
      backgroundColor:
        'rgba(255,255,255,0.78)',
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    mapLoadingText: {
      marginTop: 10,
      fontSize: 11,
      color:
        '#555555',
    },

    mapHelpText: {
      fontSize: 10,
      lineHeight: 15,
      color:
        '#777777',
      textAlign:
        'center',
      marginBottom: 22,
    },

    locationCard: {
      flexDirection:
        'row',
      borderWidth: 1,
      borderColor:
        '#E4E4E4',
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
    },

    locationIconContainer: {
      width: 45,
      height: 45,
      borderRadius: 13,
      backgroundColor:
        '#F4F4F4',
      alignItems:
        'center',
      justifyContent:
        'center',
      marginRight: 13,
    },

    locationIcon: {
      fontSize: 22,
    },

    locationDetails: {
      flex: 1,
    },

    locationAddress: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight:
        '600',
      color:
        '#111111',
    },

    locationCoordinates: {
      marginTop: 4,
      fontSize: 10,
      color:
        '#777777',
    },

    providerText: {
      marginTop: 5,
      fontSize: 9,
      color:
        '#999999',
    },

    addressDetailsCard: {
      borderWidth: 1,
      borderColor:
        '#E8E8E8',
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
    },

    addressDetailsTitle: {
      fontSize: 14,
      fontWeight:
        '700',
      marginBottom: 12,
      color:
        '#111111',
    },

    detailRow: {
      flexDirection:
        'row',
      justifyContent:
        'space-between',
      paddingVertical: 9,
      borderBottomWidth: 1,
      borderBottomColor:
        '#F0F0F0',
    },

    lastDetailRow: {
      borderBottomWidth: 0,
    },

    detailLabel: {
      width: 95,
      fontSize: 11,
      color:
        '#777777',
    },

    detailValue: {
      flex: 1,
      textAlign:
        'right',
      fontSize: 12,
      fontWeight:
        '600',
      color:
        '#333333',
    },

    bottomArea: {
      position:
        'absolute',
      left: 20,
      right: 20,
      bottom: 10,
      paddingTop: 10,
      backgroundColor:
        '#FFFFFF',
    },

    useLocationButton: {
      minHeight: 52,
      borderRadius: 13,
      backgroundColor:
        '#111111',
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    useLocationButtonText: {
      color:
        '#FFFFFF',
      fontSize: 16,
      fontWeight:
        '700',
    },

    buttonDisabled: {
      opacity: 0.4,
    },
  });
