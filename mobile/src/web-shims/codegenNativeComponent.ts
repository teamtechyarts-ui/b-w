import React from 'react';

export default function codegenNativeComponent(_componentName: string, _options?: any) {
  return React.forwardRef((props: any, ref: any) => {
    return React.createElement('div', { ...props, ref });
  });
}
