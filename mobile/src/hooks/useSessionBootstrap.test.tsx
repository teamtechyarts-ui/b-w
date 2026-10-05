import {useState} from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import {useSessionBootstrap} from './useSessionBootstrap';
import {getMyProfile} from '../services/authApi';

jest.mock('../services/authApi', () => ({getMyProfile: jest.fn()}));
const getProfile = getMyProfile as jest.MockedFunction<typeof getMyProfile>;
const customer = {accountRole: 'customer'};
const base = () => ({
  hydrating: false,
  authenticated: true,
  accessToken: 'customer-token',
  profile: customer,
  setProfile: jest.fn(async () => {}),
  loadServices: jest.fn(async () => {}),
  loadAddresses: jest.fn(async () => {}),
});

beforeEach(() => {
  jest.clearAllMocks();
  getProfile.mockResolvedValue(customer);
});

test('profile persistence rerenders cannot cancel catalogue and address loading', async () => {
  let finishSave!: () => void;
  const saved = new Promise<void>(resolve => {
    finishSave = resolve;
  });
  const options = base();
  const view = await renderHook(() => {
    const [profile, setProfile] = useState<unknown>(customer);
    return useSessionBootstrap({
      ...options,
      profile,
      setProfile: async next => {
        setProfile({...next as object});
        await saved;
      },
      loadAddresses: async () => {
        await options.loadAddresses();
      },
    });
  });
  await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(1));
  expect(options.loadServices).not.toHaveBeenCalled();
  await act(async () => {
    finishSave();
    await saved;
  });
  await waitFor(() => expect(options.loadServices).toHaveBeenCalledWith('customer-token'));
  expect(options.loadAddresses).toHaveBeenCalledTimes(1);
  expect(view.result.current).toBe(true);
});

test('fresh login after hydration starts customer bootstrap', async () => {
  const options = base();
  const view = await renderHook<boolean, {authenticated: boolean; hydrating: boolean; accessToken: string}>(
    ({authenticated, hydrating, accessToken}) =>
      useSessionBootstrap({...options, authenticated, hydrating, accessToken}),
    {initialProps: {authenticated: false, hydrating: true, accessToken: ''}},
  );
  expect(options.loadServices).not.toHaveBeenCalled();
  await view.rerender({authenticated: true, hydrating: false, accessToken: 'new-token'});
  await waitFor(() => expect(options.loadServices).toHaveBeenCalledWith('new-token'));
});

test('access-token refresh preserves resolved=true and does not trigger splash/unmount', async () => {
  const options = base();
  const view = await renderHook<boolean, {accessToken: string}>(
    ({accessToken}) => useSessionBootstrap({...options, accessToken}),
    {initialProps: {accessToken: 'token-initial'}},
  );

  // 1. Initial cold boot resolves to true
  await waitFor(() => expect(view.result.current).toBe(true));
  expect(options.loadServices).toHaveBeenCalledWith('token-initial');

  // 2. Token refreshes in the background
  await view.rerender({accessToken: 'token-refreshed'});

  // 3. resolved MUST remain true immediately (no toggle to false)
  expect(view.result.current).toBe(true);
  await waitFor(() => expect(options.loadServices).toHaveBeenCalledWith('token-refreshed'));
  expect(view.result.current).toBe(true);
});

test('logout invalidates a pending profile request and resets bootstrap state', async () => {
  let resolveProfile!: (profile: unknown) => void;
  getProfile.mockReturnValue(new Promise(resolve => {
    resolveProfile = resolve;
  }));
  const options = base();
  const view = await renderHook<boolean, {authenticated: boolean}>(
    ({authenticated}) => useSessionBootstrap({...options, authenticated}),
    {initialProps: {authenticated: true}},
  );
  await view.rerender({authenticated: false});
  await act(async () => {
    resolveProfile(customer);
  });
  expect(options.setProfile).not.toHaveBeenCalled();
  expect(options.loadServices).not.toHaveBeenCalled();
});

test('offline profile request still reaches customer loading and retry states', async () => {
  getProfile.mockRejectedValue(new Error('offline'));
  const options = base();
  await renderHook(() => useSessionBootstrap(options));
  await waitFor(() => expect(options.loadServices).toHaveBeenCalled());
});

test.each(['driver', 'admin', 'manager', 'facility_employee'])(
  '%s session does not load customer data',
  async role => {
    getProfile.mockResolvedValue({accountRole: role});
    const options = base();
    const view = await renderHook(() =>
      useSessionBootstrap({...options, profile: {accountRole: role}}),
    );
    await waitFor(() => expect(view.result.current).toBe(true));
    expect(options.loadServices).not.toHaveBeenCalled();
    expect(options.loadAddresses).not.toHaveBeenCalled();
  },
);
