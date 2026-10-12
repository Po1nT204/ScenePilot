export type AuthState = {
  message: string;
  success?: boolean;
};

export const initialAuthState: AuthState = { message: "" };
