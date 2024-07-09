import { CommonActions } from "@react-navigation/native";
import { createRef } from "react";


export const navigationRef = createRef();
export const currentScreen = createRef();


export function navigate(props) {
    navigationRef.current?.navigate(props);
}

export function reset(...props) {
    navigationRef.current?.reset(...props);
}

export function replace(...props) {
    navigationRef.current?.replace(...props);
}

export function goBack() {
    navigationRef.current?.canGoBack() && navigationRef.current?.goBack();
}

export function resetStack(stackName) {
    navigationRef.current?.dispatch(
        CommonActions.reset({
            index: 0,
            routes: [stackName]
        })
    );
}