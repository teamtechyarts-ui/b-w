import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import AppIcon from './AppIcon';

export type CheckoutStep = 'cart' | 'address' | 'schedule' | 'review' | 'payment';

type Props = {
  currentStep: CheckoutStep;
};

const STEPS: {key: CheckoutStep; label: string; number: number}[] = [
  {key: 'cart', label: 'Cart', number: 1},
  {key: 'address', label: 'Address', number: 2},
  {key: 'schedule', label: 'Schedule', number: 3},
  {key: 'review', label: 'Review', number: 4},
  {key: 'payment', label: 'Payment', number: 5},
];

export default function CheckoutProgressBar({currentStep}: Props) {
  const currentIndex = STEPS.findIndex(s => s.key === currentStep);

  return (
    <View style={styles.container}>
      <View style={styles.stepsRow}>
        {STEPS.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;

          return (
            <React.Fragment key={step.key}>
              <View style={styles.stepItem}>
                <View
                  style={[
                    styles.stepCircle,
                    isCompleted && styles.stepCircleCompleted,
                    isCurrent && styles.stepCircleCurrent,
                  ]}>
                  {isCompleted ? (
                    <AppIcon name="check" size={12} color="#FFFFFF" />
                  ) : (
                    <Text
                      style={[
                        styles.stepNumber,
                        isCurrent && styles.stepNumberCurrent,
                      ]}>
                      {step.number}
                    </Text>
                  )}
                </View>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.stepLabel,
                    isCurrent && styles.stepLabelCurrent,
                    isCompleted && styles.stepLabelCompleted,
                  ]}>
                  {step.label}
                </Text>
              </View>

              {index < STEPS.length - 1 ? (
                <View
                  style={[
                    styles.connectorLine,
                    index < currentIndex && styles.connectorLineCompleted,
                  ]}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
    paddingHorizontal: 6,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    marginBottom: 12,
  },
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepItem: {
    alignItems: 'center',
    minWidth: 44,
  },
  stepCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F3F4F6',
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  stepCircleCurrent: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  stepCircleCompleted: {
    backgroundColor: '#15803D',
    borderColor: '#15803D',
  },
  stepNumber: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
  },
  stepNumberCurrent: {
    color: '#FFFFFF',
  },
  stepCheckmark: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  stepLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  stepLabelCurrent: {
    fontWeight: '700',
    color: '#111111',
  },
  stepLabelCompleted: {
    color: '#15803D',
    fontWeight: '600',
  },
  connectorLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 4,
    marginBottom: 12,
  },
  connectorLineCompleted: {
    backgroundColor: '#15803D',
  },
});
