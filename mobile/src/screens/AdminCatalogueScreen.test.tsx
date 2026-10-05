import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import AdminCatalogueScreen from './AdminCatalogueScreen';
import {
  createAdminCategory,
  createAdminService,
  getAdminCatalogue,
  setAdminPricingPolicy,
  setAdminServicePrice,
  updateAdminCategory,
  updateAdminService,
} from '../services/adminCatalogueApi';
import {listAdminFacilities} from '../services/adminStaffApi';

jest.mock('../services/adminCatalogueApi', () => ({
  getAdminCatalogue: jest.fn(),
  createAdminCategory: jest.fn(),
  updateAdminCategory: jest.fn(),
  createAdminService: jest.fn(),
  updateAdminService: jest.fn(),
  setAdminServicePrice: jest.fn(),
  setAdminPricingPolicy: jest.fn(),
  setAdminPackageEligibility: jest.fn(),
}));
jest.mock('../services/adminStaffApi', () => ({
  listAdminFacilities: jest.fn(),
}));

const load = getAdminCatalogue as jest.Mock;
const price = setAdminServicePrice as jest.Mock;
const updateService = updateAdminService as jest.Mock;
const createService = createAdminService as jest.Mock;
const createCategory = createAdminCategory as jest.Mock;
const updateCategory = updateAdminCategory as jest.Mock;
const setPolicy = setAdminPricingPolicy as jest.Mock;

jest.setTimeout(25000);

const sample = {
  categories: [
    {id: 'category', name: 'Wash', description: null, is_active: true},
    {id: 'cat2', name: 'Dry Clean', description: null, is_active: true},
    {id: 'cat3', name: 'Empty Cat', description: null, is_active: true},
    {id: 'cat4', name: 'Shoe Cleaning', description: null, is_active: true},
    {id: 'cat5', name: 'Household & Linen', description: null, is_active: true},
    {id: 'cat6', name: 'Legacy Inactive Care', description: null, is_active: false},
  ],
  services: [
    {id: 'service', category_id: 'category', name: 'Shirt', description: null, pricing_unit: 'item', is_active: true},
    {id: 'service2', category_id: 'cat2', name: 'Trousers', description: null, pricing_unit: 'piece', is_active: false},
    {id: 'service3', category_id: 'cat6', name: 'Old Silk Saree', description: null, pricing_unit: 'piece', is_active: true},
  ],
  prices: [{id: 'price', service_id: 'service', facility_id: null, price: 50, effective_from: '2026-01-01', effective_to: null}],
  policy: {pickupDeliveryFee: 50, freeDeliveryThreshold: 500, gstRatePercent: 5, minimumOrderAmount: 0, effectiveFrom: '2026-01-01'},
  packageEligibility: [],
  packages: [],
  audit: [{id: 'a1', action: 'create_service', entity_id: 'service', created_at: '2026-09-29T10:00:00Z'}],
};

beforeEach(() => {
  jest.clearAllMocks();
  load.mockResolvedValue(sample);
  (listAdminFacilities as jest.Mock).mockResolvedValue([]);
  price.mockResolvedValue({});
  updateService.mockResolvedValue({});
  createService.mockResolvedValue({id: 'new-service'});
  createCategory.mockResolvedValue({id: 'new-cat'});
  updateCategory.mockResolvedValue({});
  setPolicy.mockResolvedValue({});
});

test('shows service cards, statistics and sets price', async () => {
  const view = await render(<AdminCatalogueScreen accessToken="token" onBack={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Service Catalogue')).toBeTruthy());
  expect(view.getByText('Shirt')).toBeTruthy();
  expect(view.getByText('Wash')).toBeTruthy();
  expect(view.getAllByLabelText('Status: Active').length).toBeGreaterThanOrEqual(1);
  expect(view.getByText('Trousers')).toBeTruthy();
  expect(view.getByLabelText('Status: Inactive')).toBeTruthy();

  // Price modal via tapping price
  await act(async () => {
    fireEvent.press(view.getByLabelText('Price: ₹50 / item'));
  });
  await waitFor(() => expect(view.getByText('Set Service Price')).toBeTruthy());

  await act(async () => {
    fireEvent.changeText(view.getByLabelText('Service price'), '75');
  });
  await act(async () => {
    fireEvent.press(view.getByText('Save new price'));
  });
  await waitFor(() => expect(price).toHaveBeenCalledWith('token', 'service', 75, undefined));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
});

test('allows deactivating and deleting service with confirmation', async () => {
  const view = await render(<AdminCatalogueScreen accessToken="token" onBack={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Service Catalogue')).toBeTruthy());

  // Deactivate via overflow menu and confirmation modal
  await act(async () => {
    fireEvent.press(view.getByLabelText('More actions for Shirt'));
  });
  await waitFor(() => expect(view.getByText('Deactivate service')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByText('Deactivate service'));
  });
  await waitFor(() => expect(view.getByText('Deactivate service?')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByLabelText('Confirm deactivate service'));
  });
  await waitFor(() => expect(updateService).toHaveBeenCalledWith('token', 'service', {isActive: false}));

  // Delete service via overflow menu and delete confirmation
  await act(async () => {
    fireEvent.press(view.getByLabelText('More actions for Shirt'));
  });
  await waitFor(() => expect(view.getByText('Delete service')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByText('Delete service'));
  });
  await waitFor(() => expect(view.getByText('Delete service?')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByLabelText('Confirm delete service'));
  });
  await waitFor(() => expect(updateService).toHaveBeenCalledWith('token', 'service', {isActive: false}));
});

test('allows adding and editing a service with full category picker and search', async () => {
  const view = await render(<AdminCatalogueScreen accessToken="token" onBack={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Service Catalogue')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByLabelText('Add service'));
  });
  await waitFor(() => expect(view.getByText('Add New Service')).toBeTruthy());

  // Tap category trigger to open category sheet
  await act(async () => {
    fireEvent.press(view.getByLabelText(/Selected Category: Wash/));
  });
  await waitFor(() => expect(view.getByText('Select Category')).toBeTruthy());

  // Verify all 5 active categories appear (not limited to 3)
  expect(view.getByLabelText('Choose category Wash')).toBeTruthy();
  expect(view.getByLabelText('Choose category Dry Clean')).toBeTruthy();
  expect(view.getByLabelText('Choose category Empty Cat')).toBeTruthy();
  expect(view.getByLabelText('Choose category Shoe Cleaning')).toBeTruthy();
  expect(view.getByLabelText('Choose category Household & Linen')).toBeTruthy();
  // Inactive category should NOT appear for Add Service
  expect(view.queryByLabelText('Choose category Legacy Inactive Care')).toBeNull();

  // Search categories in service form sheet
  await act(async () => {
    fireEvent.changeText(view.getByLabelText('Search categories'), 'Shoe');
  });
  expect(view.getByLabelText('Choose category Shoe Cleaning')).toBeTruthy();
  expect(view.queryByLabelText('Choose category Wash')).toBeNull();

  // Select Shoe Cleaning
  await act(async () => {
    fireEvent.press(view.getByLabelText('Choose category Shoe Cleaning'));
  });

  // Modal returns to Add New Service form with Shoe Cleaning selected
  await waitFor(() => expect(view.getByText('Add New Service')).toBeTruthy());
  expect(view.getByLabelText(/Selected Category: Shoe Cleaning/)).toBeTruthy();

  await act(async () => {
    fireEvent.changeText(view.getByLabelText('Service name'), 'Running Shoe Spa');
    fireEvent.changeText(view.getByLabelText('Pricing unit'), 'pair');
  });
  await act(async () => {
    fireEvent.press(view.getByLabelText('Add Service'));
  });

  await waitFor(() =>
    expect(createService).toHaveBeenCalledWith('token', {
      name: 'Running Shoe Spa',
      description: undefined,
      pricingUnit: 'pair',
      categoryId: 'cat4',
    }),
  );
});

test('preserves inactive category when editing an existing service assigned to it', async () => {
  const view = await render(<AdminCatalogueScreen accessToken="token" onBack={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Old Silk Saree')).toBeTruthy());

  // Open Edit Service
  await act(async () => {
    fireEvent.press(view.getByLabelText('Edit Old Silk Saree'));
  });
  await waitFor(() => expect(view.getByText('Edit Service')).toBeTruthy());
  expect(view.getByLabelText(/Selected Category: Legacy Inactive Care/)).toBeTruthy();

  // Open category sheet - inactive category should be included and visible
  await act(async () => {
    fireEvent.press(view.getByLabelText(/Selected Category: Legacy Inactive Care/));
  });
  await waitFor(() => expect(view.getByText('Select Category')).toBeTruthy());
  expect(view.getByLabelText('Choose category Legacy Inactive Care')).toBeTruthy();
  expect(view.getAllByText('Inactive').length).toBeGreaterThanOrEqual(1);

  // Close back to form without changing
  await act(async () => {
    fireEvent.press(view.getByLabelText('Back to service form'));
  });
  await waitFor(() => expect(view.getByText('Edit Service')).toBeTruthy());
});

test('allows category management: add, edit, blocked delete and successful delete', async () => {
  const view = await render(<AdminCatalogueScreen accessToken="token" onBack={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Service Catalogue')).toBeTruthy());

  // Add Category from header
  await act(async () => {
    fireEvent.press(view.getByLabelText('Add category'));
  });
  await waitFor(() => expect(view.getByLabelText('Category name')).toBeTruthy());

  await act(async () => {
    fireEvent.changeText(view.getByLabelText('Category name'), 'Curtain Care');
  });
  await act(async () => {
    fireEvent.press(view.getByLabelText('Add Category'));
  });
  await waitFor(() =>
    expect(createCategory).toHaveBeenCalledWith('token', {
      name: 'Curtain Care',
      description: undefined,
    }),
  );

  // Open Category Bottom Sheet
  await act(async () => {
    fireEvent.press(view.getByLabelText(/Category filter/));
  });
  await waitFor(() => expect(view.getByLabelText('Search categories')).toBeTruthy());

  // Edit category via ⋮
  await act(async () => {
    fireEvent.press(view.getByLabelText('Manage category Wash'));
  });
  await waitFor(() => expect(view.getByText('Edit category')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByText('Edit category'));
  });
  await waitFor(() => expect(view.getByText('Edit Category')).toBeTruthy());

  await act(async () => {
    fireEvent.changeText(view.getByLabelText('Category name'), 'Premium Wash');
  });
  await act(async () => {
    fireEvent.press(view.getByLabelText('Save changes'));
  });
  await waitFor(() =>
    expect(updateCategory).toHaveBeenCalledWith('token', 'category', {
      name: 'Premium Wash',
      description: undefined,
    }),
  );

  // Try to delete category that has assigned services -> blocked dialog
  await act(async () => {
    fireEvent.press(view.getByLabelText(/Category filter/));
  });
  await waitFor(() => expect(view.getByLabelText('Search categories')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByLabelText('Manage category Wash'));
  });
  await waitFor(() => expect(view.getByText('Delete category')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByText('Delete category'));
  });
  await waitFor(() => expect(view.getByText('Cannot delete this category')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByLabelText('Close blocked category dialog'));
  });

  // Delete empty category -> success confirmation
  await act(async () => {
    fireEvent.press(view.getByLabelText(/Category filter/));
  });
  await waitFor(() => expect(view.getByLabelText('Search categories')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByLabelText('Manage category Empty Cat'));
  });
  await waitFor(() => expect(view.getByText('Delete category')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByText('Delete category'));
  });
  await waitFor(() => expect(view.getByText('Delete category?')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByLabelText('Confirm delete category'));
  });
  await waitFor(() => expect(updateCategory).toHaveBeenCalledWith('token', 'cat3', {isActive: false}));
});

test('allows filtering by search query and category bottom sheet', async () => {
  const view = await render(<AdminCatalogueScreen accessToken="token" onBack={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Shirt')).toBeTruthy());

  // Search filter
  await act(async () => {
    fireEvent.changeText(view.getByLabelText('Search services'), 'Trousers');
  });
  expect(view.queryByText('Shirt')).toBeNull();
  expect(view.getByText('Trousers')).toBeTruthy();

  // Reset search
  await act(async () => {
    fireEvent.changeText(view.getByLabelText('Search services'), '');
  });
  expect(view.getByText('Shirt')).toBeTruthy();

  // Category filter bottom sheet
  await act(async () => {
    fireEvent.press(view.getByLabelText(/Category filter/));
  });
  await waitFor(() => expect(view.getByLabelText('Search categories')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByLabelText('Select category Dry Clean'));
  });
  expect(view.queryByText('Shirt')).toBeNull();
  expect(view.getByText('Trousers')).toBeTruthy();
});

test('allows saving checkout policy', async () => {
  const view = await render(<AdminCatalogueScreen accessToken="token" onBack={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Service Catalogue')).toBeTruthy());

  // Expand policy accordion
  await act(async () => {
    fireEvent.press(view.getByLabelText('Toggle checkout policy section'));
  });

  await act(async () => {
    fireEvent.changeText(view.getByLabelText('Pickup and delivery fee'), '40');
    fireEvent.changeText(view.getByLabelText('Free delivery threshold'), '499');
    fireEvent.changeText(view.getByLabelText('GST rate percent'), '18');
    fireEvent.changeText(view.getByLabelText('Minimum order amount'), '199');
  });

  await act(async () => {
    fireEvent.press(view.getByText('Save checkout policy'));
  });
  await waitFor(() =>
    expect(setPolicy).toHaveBeenCalledWith('token', {
      pickupDeliveryFee: 40,
      freeDeliveryThreshold: 499,
      gstRatePercent: 18,
      minimumOrderAmount: 199,
    }),
  );
});

test('shows loading failure and retry', async () => {
  load.mockRejectedValueOnce(new Error('Network unavailable'));
  const view = await render(<AdminCatalogueScreen accessToken="token" onBack={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Network unavailable')).toBeTruthy());
  await act(async () => {
    fireEvent.press(view.getByLabelText('Retry catalogue'));
  });
  await waitFor(() => expect(view.getByText('Shirt')).toBeTruthy());
});
