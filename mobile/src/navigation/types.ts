export type RootStackParamList = {
  Welcome: undefined;
  Login: undefined;
  DriverLogin: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
  ResetPassword: {accessToken?: string} | undefined;
  Otp: {phone: string};

  Home: undefined;
  Account: undefined;
  Category: {categoryName: string};
  Cart: undefined;

  Addresses: {mode?: 'manage'} | undefined;

  AddressForm:
    | {addressId?: string}
    | undefined;

  LocationPicker: undefined;

  PickupSlot: undefined;
  OrderReview: undefined;
  Payment: undefined;

  OrderSuccess: {
    orderId: string;
  };

  Orders: undefined;

  OrderDetails: {
    orderId: string;
  };

  Notifications: undefined;
  Benefits: undefined;
  Profile: undefined;
  DriverProfile: undefined;
  DriverDashboard: undefined;
  DriverNotifications: undefined;
  DriverJobDetail: {assignmentId: string};
  FacilityDashboard: undefined;
  AdminDashboard: undefined;
  AdminCustomers: undefined;
  AdminCustomerDetail: {customerId: string};
  AdminOrderDetail: {orderId: string};
  AdminStaff: undefined;
  AdminStaffDetail: {profileId: string};
  AdminAssignments: undefined;
  AdminCatalogue: undefined;
  AdminIssues: undefined;
  AdminIssueDetail: {orderId: string};
  AdminGrowth: undefined;
  AdminFacilities: undefined;
  AdminLocations: undefined;
  AdminFacilityDetail: {facilityId: string};
  AdminFacilityOrder: {facilityId: string; orderId: string};
  AdminReports: undefined;
  FacilityIntake: undefined;
  FacilityVerification: {orderId: string};
  Support: {showTerms?: boolean} | undefined;
  Receipt: {orderId: string};
};
