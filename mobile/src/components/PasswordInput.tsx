import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
  StyleProp,
  ViewStyle,
  TextStyle,
} from 'react-native';

export type PasswordInputProps = Omit<TextInputProps, 'secureTextEntry'> & {
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
};

export default function PasswordInput({
  containerStyle,
  inputStyle,
  placeholder = 'Password',
  value,
  onChangeText,
  ...rest
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={[styles.wrapper, containerStyle]}>
      <TextInput
        style={[styles.input, inputStyle]}
        placeholder={placeholder}
        placeholderTextColor="#888888"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="none"
        {...rest}
      />
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        accessibilityHint="Toggles password visibility"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.eyeButton}
        onPress={() => setVisible(prev => !prev)}>
        <Text style={styles.eyeText}>{visible ? 'Hide' : 'Show'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    width: '100%',
    marginBottom: 20,
    justifyContent: 'center',
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#CCCCCC',
    borderRadius: 12,
    paddingLeft: 16,
    paddingRight: 60,
    paddingVertical: 15,
    fontSize: 17,
    color: '#111111',
    backgroundColor: '#FFFFFF',
  },
  eyeButton: {
    position: 'absolute',
    right: 14,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  eyeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4B5563',
  },
});
