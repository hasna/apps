import type { OutboxConsumeOptions as DirectOutboxConsumeOptions } from '../dist/outbox-consume.js';
import type { OutboxConsumeOptions as RootOutboxConsumeOptions } from '@hasna/knowledge';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;
type PublicShape<Value> = { [Key in keyof Value]: Value[Key] };

type PinnedOutboxConsumeOptions = {
  dbPath: string;
  input: string;
  config?: DirectOutboxConsumeOptions['config'];
  safetyPolicy?: DirectOutboxConsumeOptions['safetyPolicy'];
  now?: Date;
};

type _DirectExact = Expect<Equal<DirectOutboxConsumeOptions, PinnedOutboxConsumeOptions>>;
type _DirectKeys = Expect<Equal<keyof DirectOutboxConsumeOptions, keyof PinnedOutboxConsumeOptions>>;
type _DirectMapped = Expect<Equal<
  PublicShape<DirectOutboxConsumeOptions>,
  PublicShape<PinnedOutboxConsumeOptions>
>>;
type _RootExact = Expect<Equal<RootOutboxConsumeOptions, PinnedOutboxConsumeOptions>>;
type _RootKeys = Expect<Equal<keyof RootOutboxConsumeOptions, keyof PinnedOutboxConsumeOptions>>;
type _RootMapped = Expect<Equal<
  PublicShape<RootOutboxConsumeOptions>,
  PublicShape<PinnedOutboxConsumeOptions>
>>;

declare const directOptions: DirectOutboxConsumeOptions;
declare const rootOptions: RootOutboxConsumeOptions;
void directOptions;
void rootOptions;
