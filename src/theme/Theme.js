import { createTheme } from '@rneui/themed';

const lightTheme = createTheme({
  lightColors: {
    primary: '#f2f2f2', // Light primary color
    secondary: '#007bff', // Light secondary color
    background: '#fff', // Light background color
    text: '#000', // Light text color
    // ...other light color definitions
  },
});

const darkTheme = createTheme({
  darkColors: {
    primary: '#121212', // Dark primary color
    secondary: '#007bff', // Dark secondary color (can be same for consistency)
    background: '#000', // Dark background color
    text: '#fff', // Dark text color
    // ...other dark color definitions
  },
});
