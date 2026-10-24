// @ts-ignore
jest.setTimeout(25000);
import React from 'react';
import {fireEvent, render, within} from '@testing-library/react-native';
import HomeScreen from './HomeScreen';
import type {ServiceItem} from '../types/service';
const services: ServiceItem[] = [
  {id: 'shirt', categoryId: 'wash', categoryName: 'Wash & Iron', name: 'Shirt', description: 'Clean and pressed', pricingUnit: 'piece', price: 40, facilityId: null},
  {id: 'coat', categoryId: 'dry', categoryName: 'Dry Cleaning', name: 'Coat', description: null, pricingUnit: 'piece', price: 180, facilityId: null},
];
const base = {customerName: 'Tarun Reddy', servicesLoading: false, servicesError: '', services, categories: [{id: 'wash', name: 'Wash & Iron', count: 1}, {id: 'dry', name: 'Dry Cleaning', count: 1}], addresses: [{id: 'address', label: 'Home', address_line1: 'Banjara Hills', address_line2: null, city: 'Hyderabad', state: 'Telangana', postal_code: '500034', latitude: null, longitude: null, is_default: true}], selectedAddressId: 'address', cartItemCount: 0, getQuantity: () => 0, onSelectAddress: jest.fn(), onManageAddresses: jest.fn(), onOpenCart: jest.fn(), onOpenNotifications: jest.fn(), onRetryServices: jest.fn(), onUpdateQuantity: jest.fn()};
describe('customer Home catalogue', () => {
  beforeEach(() => jest.clearAllMocks());
  it('shows categories and triggers navigation to dedicated category page without inline services', async () => {
    const onOpenCategory = jest.fn();
    const view = await render(<HomeScreen {...base} onOpenCategory={onOpenCategory} />);
    expect(view.getByText('Wash & Iron')).toBeTruthy();
    expect(view.getByText('Dry Cleaning')).toBeTruthy();
    expect(view.queryByText('Shirt')).toBeNull();
    expect(view.queryByText('Coat')).toBeNull();

    await fireEvent.press(view.getByText('Wash & Iron'));
    expect(onOpenCategory).toHaveBeenCalledWith('Wash & Iron');
    // Ensure services are NOT displayed inline below category grid
    expect(view.queryByText('Shirt')).toBeNull();
    expect(view.queryByText('Coat')).toBeNull();
  });

  it('filters out malformed category names such as "e"', async () => {
    const mixedCategories = [
      {id: 'c-1', name: 'Wash & Iron', count: 1},
      {id: 'c-bad', name: 'e', count: 2},
      {id: 'c-2', name: 'Dry Cleaning', count: 1},
    ];
    const view = await render(<HomeScreen {...base} categories={mixedCategories} />);
    expect(view.getByText('Wash & Iron')).toBeTruthy();
    expect(view.getByText('Dry Cleaning')).toBeTruthy();
    expect(view.queryByText('e')).toBeNull();
  });

  it('shows delivery address and contains no internal labels', async () => {
    const view = await render(<HomeScreen {...base} />);
    expect(view.getByLabelText('Choose delivery address')).toBeTruthy();
    const content = JSON.stringify(view.toJSON()).toLowerCase();
    ['fictional', 'fixture', 'development test mode', 'mock location', '9e'].forEach(label => expect(content).not.toContain(label));
  });

  it('renders error retry and empty catalogue states', async () => {
    const errorView = await render(<HomeScreen {...base} services={[]} categories={[]} servicesError="Unable to load services" />);
    await fireEvent.press(errorView.getByText('Try again'));
    expect(base.onRetryServices).toHaveBeenCalled();
    await errorView.unmount();
    const emptyView = await render(<HomeScreen {...base} services={[]} categories={[]} />);
    expect(emptyView.getByText('No services are available right now.')).toBeTruthy();
  });
});

test('welcomes the authenticated profile name with a safe missing-name fallback', async () => {
  const named = await render(<HomeScreen {...base} />);
  expect(named.getByText('Welcome Tarun Reddy')).toBeTruthy();
  await named.unmount();
  const unnamed = await render(<HomeScreen {...base} customerName={null} />);
  expect(unnamed.getByText('Welcome')).toBeTruthy();
});

test('has no search field and keeps loading and empty states clear', async () => {
  const view = await render(<HomeScreen {...base} services={[]} categories={[]} servicesLoading />);
  expect(view.queryByLabelText('Search services')).toBeNull();
  expect(view.queryByLabelText('Choose service category')).toBeNull();
  expect(view.queryByText('No services are available right now.')).toBeNull();
  expect(view.getByLabelText('Loading services')).toBeTruthy();
});

test('renders every category without a horizontally scrolling selector', async () => {
  const categories = Array.from({length: 9}, (_, index) => ({id: `category-${index}`, name: `Category ${index + 1}`, count: index + 1}));
  const view = await render(<HomeScreen {...base} categories={categories} />);
  categories.forEach(category => expect(view.getByText(category.name)).toBeTruthy());
  expect(view.queryByLabelText('Search services')).toBeNull();
});

test('address selection uses the server address and updates the selected id', async () => {
  const view = await render(<HomeScreen {...base} />);
  await fireEvent.press(view.getByLabelText('Choose delivery address'));
  expect(view.getByText('Banjara Hills')).toBeTruthy();
  await fireEvent.press(view.getByText('Banjara Hills'));
  expect(base.onSelectAddress).toHaveBeenCalledWith('address');
});

test('renders distinct urgent action cards for multiple active orders requiring OTP and navigates directly', async () => {
  const onOpenOrder = jest.fn();
  const activeUrgentOrders: any = [
    {
      id: 'order-1',
      order_number: 'BW-20261003-7CB85C51',
      current_status: 'pickup_otp_pending',
    },
    {
      id: 'order-2',
      order_number: 'BW-TEST-709166',
      current_status: 'delivery_otp_pending',
    },
  ];

  const view = await render(
    <HomeScreen
      {...base}
      activeUrgentOrders={activeUrgentOrders}
      onOpenOrder={onOpenOrder}
    />,
  );

  // Checks both cards exist simultaneously with exact order numbers
  expect(view.getByText('Order BW-20261003-7CB85C51')).toBeTruthy();
  expect(view.getByText('Order BW-TEST-709166')).toBeTruthy();
  expect(view.getByText('Give Pickup OTP →')).toBeTruthy();
  expect(view.getByText('Give Delivery OTP →')).toBeTruthy();

  await fireEvent.press(view.getByText('Give Pickup OTP →'));
  expect(onOpenOrder).toHaveBeenCalledWith('order-1');

  await fireEvent.press(view.getByText('Give Delivery OTP →'));
  expect(onOpenOrder).toHaveBeenCalledWith('order-2');
});

test('renders distinct, semantically appropriate AppIcon components for category cards', async () => {
  const fullCategories = [
    {id: 'cat-1', name: 'Wash & Fold', count: 1},
    {id: 'cat-2', name: 'Wash & Iron', count: 32},
    {id: 'cat-3', name: 'Wash & Steam Iron', count: 1},
    {id: 'cat-4', name: 'Steam Ironing', count: 14},
    {id: 'cat-5', name: 'Dry Cleaning', count: 44},
    {id: 'cat-6', name: 'Household & Linen Care', count: 18},
    {id: 'cat-7', name: 'Shoe Cleaning', count: 10},
    {id: 'cat-8', name: 'Premium Laundry', count: 1},
    {id: 'cat-9', name: 'Add-On Services', count: 11},
    {id: 'cat-10', name: 'new testing category edited', count: 1},
  ];

  const view = await render(<HomeScreen {...base} categories={fullCategories} />);

  // Component-level rendered AppIcons verification
  expect(within(view.getByTestId('category-icon-container-wash-and-fold')).getByTestId('icon-wash-fold')).toBeTruthy();
  expect(within(view.getByTestId('category-icon-container-wash-and-iron')).getByTestId('icon-wash-iron')).toBeTruthy();
  expect(within(view.getByTestId('category-icon-container-wash-and-steam-iron')).getByTestId('icon-wash-iron')).toBeTruthy();
  expect(within(view.getByTestId('category-icon-container-steam-ironing')).getByTestId('icon-iron')).toBeTruthy();
  expect(within(view.getByTestId('category-icon-container-dry-cleaning')).getByTestId('icon-hanger')).toBeTruthy();
  expect(within(view.getByTestId('category-icon-container-household-and-linen-care')).getByTestId('icon-bed')).toBeTruthy();
  expect(within(view.getByTestId('category-icon-container-shoe-cleaning')).getByTestId('icon-shoe')).toBeTruthy();
  expect(within(view.getByTestId('category-icon-container-premium-laundry')).getByTestId('icon-shirt')).toBeTruthy();
  expect(within(view.getByTestId('category-icon-container-add-on-services')).getByTestId('icon-plus')).toBeTruthy();
  expect(within(view.getByTestId('category-icon-container-new-testing-category-edited')).getByTestId('icon-tag')).toBeTruthy();
});

