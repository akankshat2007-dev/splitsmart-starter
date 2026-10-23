import AuthForm from '../auth-form';

export const metadata = { title: 'Reset password | SplitSmart' };

export default function ForgotPasswordPage() {
  return <AuthForm mode="forgot" />;
}
