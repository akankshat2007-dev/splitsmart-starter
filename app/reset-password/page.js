import AuthForm from '../auth-form';

export const metadata = { title: 'Choose a new password | SplitSmart' };

export default function ResetPasswordPage() {
  return <AuthForm mode="reset" />;
}
