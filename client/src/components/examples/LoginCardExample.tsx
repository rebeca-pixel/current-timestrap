import LoginCard from '../LoginCard';

export default function LoginCardExample() {
  return (
    <LoginCard 
      onLogin={async (code, name, password) => {
        console.log('Login attempt:', { code, name, password });
        await new Promise(resolve => setTimeout(resolve, 1000));
        return true;
      }}
      onForgotPassword={() => console.log('Forgot password clicked')}
    />
  );
}
