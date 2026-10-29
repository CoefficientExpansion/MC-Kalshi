// Shared by the sign-in form (client) and its action (server). Not a "use server" file, so it can
// export a constant as well as the type.

export interface SignInState {
  readonly step: "email" | "code";
  /** Normalised once a code has been sent; as typed before that. */
  readonly email: string;
  readonly error?: string;
  readonly notice?: string;
}

export const INITIAL_SIGN_IN_STATE: SignInState = { step: "email", email: "" };
