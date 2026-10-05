import React from 'react';
import {StyleSheet, View} from 'react-native';
import CustomerBottomNavigation, {CustomerTab} from './CustomerBottomNavigation';

type Props = React.PropsWithChildren<{
  active: CustomerTab;
  onHome: () => void;
  onOrders: () => void;
  onAccount: () => void;
  onPackages?: () => void;
}>;

export default function CustomerTabFrame({children, ...navigation}: Props) {
  return (
    <View style={styles.page}>
      <View style={styles.content}>{children}</View>
      <CustomerBottomNavigation {...navigation} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#fff'},
  content: {flex: 1},
});
