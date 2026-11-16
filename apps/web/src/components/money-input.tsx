import { useEffect, useRef, useState } from 'react';
import { parseMoneyToSatang, satangToBahtString } from '@nexora/shared';
import { Input, type InputProps } from './ui';

export function MoneyInput({
  value,
  onChange,
  ...props
}: Omit<InputProps, 'value' | 'onChange'> & {
  value: number;
  onChange: (satang: number) => void;
}) {
  const [text, setText] = useState(value ? satangToBahtString(value) : '');
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value ? satangToBahtString(value) : '');
  }, [value]);

  return (
    <Input
      {...props}
      inputMode="decimal"
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = parseMoneyToSatang(next);
        if (parsed !== null) onChange(parsed);
      }}
      onBlur={() => {
        focused.current = false;
        const parsed = parseMoneyToSatang(text);
        if (parsed === null) {
          setText(value ? satangToBahtString(value) : '');
        } else {
          onChange(parsed);
          setText(parsed ? satangToBahtString(parsed) : '');
        }
      }}
    />
  );
}
