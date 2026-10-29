# UML Class Diagram — HappyWash Laundry Management System

## 1. Overview

This document presents a comprehensive UML class diagram for the HappyWash Laundry Management System, a full-stack TypeScript application built on Express + Vite + React + SQLite. The diagram captures all core domain entities, value objects, aggregates, their relationships, design patterns, cross-cutting concerns, and bounded-context boundaries.

---

## 2. Mermaid.js Class Diagram

```mermaid
classDiagram
    direction TB

    %% ============================================================
    %% VALUE OBJECTS
    %% ============================================================
    class Money {
        -amount: number
        -currency: string
        +add(other: Money): Money
        +subtract(other: Money): Money
        +multiply(factor: number): Money
        +format(): string
    }

    class ReferenceNumber {
        -value: string
        -prefix: string
        -timestamp: string
        -random: string
        +toString(): string
        +validate(): boolean
    }

    class CustomerInfo {
        -name: string
        -phone: string
        -email: string
        +isValid(): boolean
    }

    class Address {
        -street: string
        -city: string
        -postalCode: string
        +format(): string
    }

    class PhoneNumber {
        -countryCode: string
        -number: string
        +format(): string
        +isValid(): boolean
    }

    class JwtPayload {
        +userId: string
        +username: string
        +type: string
        +role: string
        +expiresAt: number
    }

    class PaginationMeta {
        +page: number
        +limit: number
        +total: number
        +totalPages: number
    }

    class PricingConfig {
        +pricing_type: PricingType
        +base_price: number
        +tier_1_limit: number
        +tier_1_price: number
        +tier_2_limit: number
        +tier_2_price: number
        +tier_3_limit: number
        +tier_3_price: number
        +tier_4_limit: number
        +tier_4_price: number
        +tier_5_price_per_kg: number
        +per_kg_price: number
        +is_active: number
        +delivery_fee: number
    }

    class PasswordStrength {
        +score: number
        +feedback: string[]
        +isValid: boolean
    }

    %% ============================================================
    %% DOMAIN ENTITIES
    %% ============================================================

    %% --- Transaction Aggregate ---
    class Transaction {
        -id: number
        -referenceNumber: ReferenceNumber
        -customerInfo: CustomerInfo
        -serviceType: string
        -quantity: number
        -specialInstructions: string
        -weight: number
        -appointmentDate: string
        -appointmentTime: string
        -deliveryMethod: DeliveryMethod
        -address: Address
        -status: TransactionStatus
        -totalPrice: Money
        -deliveryFee: Money
        -paymentStatus: PaymentStatus
        -paymentMethod: string
        -handwashProofImage: string
        -createdAt: Date
        -updatedAt: Date
        -deletedAt: Date
        +updateStatus(newStatus: TransactionStatus): void
        +assignMachine(machine: Machine): void
        +unassignMachine(): void
        +calculateTotal(): Money
        +canTransitionTo(status: TransactionStatus): boolean
        +isHandWash(): boolean
        +softDelete(): void
    }

    class TransactionItem {
        -id: number
        -serviceType: string
        -quantity: number
        -unitPrice: Money
        -totalPrice: Money
        -createdAt: Date
        +getSubtotal(): Money
    }

    class Review {
        -id: number
        -transactionId: number
        -rating: number
        -comment: string
        -createdAt: Date
        +isValidRating(): boolean
    }

    class QueueEntry {
        -id: number
        -transactionId: number
        -position: number
        -estimatedWaitTime: number
        -estimatedStartTime: Date
        -estimatedEndTime: Date
        -status: QueueStatus
        -createdAt: Date
        +advancePosition(): void
        +complete(): void
        +cancel(): void
    }

    %% --- Machine Aggregate ---
    class Machine {
        -id: number
        -name: string
        -type: MachineType
        -capacity: number
        -status: MachineStatus
        -remainingTime: number
        -avgCycleTime: number
        -totalJobsCompleted: number
        -isDefault: boolean
        -currentTransactionId: number
        +startCycle(transaction: Transaction): void
        +completeCycle(): void
        +setMaintenance(): void
        +setAvailable(): void
        +decrementTime(): void
        +isAvailable(): boolean
    }

    %% --- Pricing Aggregate ---
    class Pricing {
        -id: number
        -serviceType: string
        -pricingType: PricingType
        -basePrice: number
        -tier1Limit: number
        -tier1Price: number
        -tier2Limit: number
        -tier2Price: number
        -tier3Limit: number
        -tier3Price: number
        -tier4Limit: number
        -tier4Price: number
        -tier5PricePerKg: number
        -perKgPrice: number
        -isActive: boolean
        -deliveryFee: number
        -updatedAt: Date
        +calculatePrice(quantity: number): Money
        +getDeliveryFee(): Money
        +isActive(): boolean
        +toConfig(): PricingConfig
    }

    class PriceHistory {
        -id: number
        -serviceType: string
        -oldPriceData: string
        -newPriceData: string
        -changedBy: string
        -createdAt: Date
        +getChanges(): PriceChange[]
    }

    %% --- Admin / Security Aggregate ---
    class AdminUser {
        -id: number
        -username: string
        -passwordHash: string
        -role: AdminRole
        -lastLogin: Date
        -createdAt: Date
        -updatedAt: Date
        +verifyPassword(password: string): boolean
        +hasRole(role: AdminRole): boolean
        +canAccess(resource: string): boolean
        +updateLastLogin(): void
    }

    class AuditLog {
        -id: number
        -adminId: number
        -action: AuditAction
        -details: string
        -ipAddress: string
        -userAgent: string
        -createdAt: Date
        +log(): void
    }

    %% --- Reporting / Analytics ---
    class Stats {
        +totalOrders: number
        +totalSales: Money
        +pendingOrders: number
    }

    class SalesData {
        +totalOrders: number
        +totalSales: number
        +pendingOrders: number
        +completedOrders: number
        +declinedOrders: number
        +dailySales: DailySales[]
        +serviceBreakdown: ServiceBreakdown[]
        +paymentBreakdown: PaymentBreakdown[]
        +walkInOrders: number
        +walkInSales: number
        +bookingOrders: number
        +bookingSales: number
        +averageOrderValue: number
        +completionRate: number
        +peakHours: PeakHour[]
        +peakDays: PeakDay[]
        +topCustomers: TopCustomer[]
    }

    class Customer {
        -customerName: string
        -customerPhone: string
        -address: Address
        -createdAt: Date
        -totalOrders: number
        -totalSpent: Money
    }

    %% ============================================================
    %% ENUMERATIONS
    %% ============================================================
    class TransactionStatus {
        <<enumeration>>
        pending
        accepted
        washing
        drying
        ready
        completed
        declined
    }

    class MachineStatus {
        <<enumeration>>
        available
        in_use
        maintenance
    }

    class MachineType {
        <<enumeration>>
        washer
        dryer
        all_in_one
    }

    class DeliveryMethod {
        <<enumeration>>
        pickup
        delivery
    }

    class PaymentStatus {
        <<enumeration>>
        unpaid
        paid
    }

    class PricingType {
        <<enumeration>>
        tiered
        per_kg
    }

    class AdminRole {
        <<enumeration>>
        super_admin
        admin
    }

    class QueueStatus {
        <<enumeration>>
        waiting
        in_progress
        completed
        cancelled
    }

    class AuditAction {
        <<enumeration>>
        login
        logout
        password_change
        username_change
        failed_login
    }

    %% ============================================================
    %% DESIGN PATTERN CLASSES
    %% ============================================================

    %% --- Strategy Pattern ---
    class PricingStrategy {
        <<interface>>
        +calculate(config: PricingConfig, quantity: number): number
    }

    class TieredPricingStrategy {
        +calculate(config: PricingConfig, quantity: number): number
    }

    class PerKgPricingStrategy {
        +calculate(config: PricingConfig, quantity: number): number
    }

    class PricingStrategyFactory {
        +create(type: PricingType): PricingStrategy
    }

    %% --- Factory Pattern ---
    class ReferenceNumberFactory {
        +generate(): ReferenceNumber
    }

    class ApiResponseFactory {
        +success~T~(data: T, meta?: PaginationMeta): ApiResponse~T~
        +error(message: string): ApiResponse~void~
    }

    %% --- Observer Pattern ---
    class MachineTimer {
        -intervalId: number
        -observers: MachineTimerObserver[]
        +start(): void
        +stop(): void
        +registerObserver(observer: MachineTimerObserver): void
        +notifyObservers(): void
    }

    class MachineTimerObserver {
        <<interface>>
        +onTick(): void
        +onMachineComplete(machine: Machine): void
    }

    %% --- Repository Pattern ---
    class TransactionRepository {
        +findById(id: number): Transaction
        +findByReference(ref: string): Transaction
        +findAll(page: number, limit: number): Transaction[]
        +save(transaction: Transaction): void
        +update(id: number, data: any): void
        +delete(id: number): void
        +softDelete(id: number): void
    }

    class MachineRepository {
        +findById(id: number): Machine
        +findAll(): Machine[]
        +save(machine: Machine): void
        +update(id: number, data: any): void
        +delete(id: number): void
        +resetAll(): void
    }

    class PricingRepository {
        +findByServiceType(type: string): Pricing
        +findAllActive(): Pricing[]
        +save(pricing: Pricing): void
        +update(serviceType: string, data: any): void
        +getHistory(): PriceHistory[]
    }

    class AdminUserRepository {
        +findByUsername(username: string): AdminUser
        +findById(id: number): AdminUser
        +save(user: AdminUser): void
        +update(id: number, data: any): void
    }

    class AuditLogRepository {
        +log(entry: AuditLog): void
        +findByAdminId(adminId: number): AuditLog[]
        +findByAction(action: AuditAction): AuditLog[]
    }

    class ReviewRepository {
        +findByTransactionId(transactionId: number): Review
        +findAll(): Review[]
        +save(review: Review): void
    }

    %% --- Middleware / Cross-cutting ---
    class AuthMiddleware {
        +requireAuth(req, res, next): void
        +requireAdmin(req, res, next): void
        +requireSuperAdmin(req, res, next): void
    }

    class RateLimitMiddleware {
        +loginRateLimiter: RateLimiter
        +apiRateLimiter: RateLimiter
        +publicRateLimiter: RateLimiter
    }

    class SecurityHeadersMiddleware {
        +applySecurityHeaders(req, res, next): void
    }

    class CorsMiddleware {
        +applyCors(req, res, next): void
    }

    class InputSanitizer {
        +sanitizeInput(str: string): string
    }

    class ValidationMiddleware {
        +transactionSchema: ZodSchema
        +loginSchema: ZodSchema
        +machineUpdateSchema: ZodSchema
        +pricingUpdateSchema: ZodSchema
    }

    %% --- Singleton ---
    class Database {
        -instance: Database
        -db: Database
        +getInstance(): Database
        +prepare(query: string): Statement
        +exec(query: string): void
        +transaction(fn: Function): Transaction
    }

    class ExpressApp {
        -instance: ExpressApp
        +getInstance(): ExpressApp
        +use(middleware): void
        +get(path, handler): void
        +post(path, handler): void
        +patch(path, handler): void
        +delete(path, handler): void
    }

    %% ============================================================
    %% AGGREGATE ROOTS
    %% ============================================================
    class TransactionAggregate {
        <<aggregate root>>
    }

    class MachineAggregate {
        <<aggregate root>>
    }

    class PricingAggregate {
        <<aggregate root>>
    }

    class AdminUserAggregate {
        <<aggregate root>>
    }

    %% ============================================================
    %% RELATIONSHIPS — Domain Entities
    %% ============================================================

    %% Transaction aggregate composition
    Transaction "1" *-- "0..*" TransactionItem : contains
    Transaction "1" o-- "0..1" Review : has
    Transaction "1" --> "0..1" Machine : assigned to
    Transaction "1" o-- "0..1" QueueEntry : queued in

    %% Pricing aggregate
    Pricing "1" o-- "0..*" PriceHistory : tracks

    %% Admin aggregate
    AdminUser "1" o-- "0..*" AuditLog : generates

    %% Value object usage
    Transaction --> ReferenceNumber : uses
    Transaction --> CustomerInfo : uses
    Transaction --> Address : uses
    Transaction --> Money : uses
    Transaction --> PhoneNumber : uses
    TransactionItem --> Money : uses
    Pricing --> PricingConfig : converts to
    Pricing --> Money : uses
    PriceHistory --> Pricing : references by serviceType
    AuditLog --> AdminUser : references by adminId
    Customer --> Money : uses
    Customer --> Address : uses
    AdminUser --> PasswordStrength : validates with
    JwtPayload --> AdminUser : derived from

    %% ============================================================
    %% RELATIONSHIPS — Design Patterns
    %% ============================================================

    %% Strategy pattern
    PricingStrategy <|.. TieredPricingStrategy : implements
    PricingStrategy <|.. PerKgPricingStrategy : implements
    PricingStrategyFactory ..> PricingStrategy : creates
    PricingStrategyFactory ..> TieredPricingStrategy : creates
    PricingStrategyFactory ..> PerKgPricingStrategy : creates
    Pricing --> PricingStrategy : delegates to
    PricingStrategyFactory ..> PricingConfig : reads

    %% Factory pattern
    ReferenceNumberFactory ..> ReferenceNumber : creates
    Transaction --> ReferenceNumberFactory : uses
    ApiResponseFactory ..> PaginationMeta : uses

    %% Observer pattern
    MachineTimer o-- MachineTimerObserver : observes
    MachineTimer --> Machine : monitors
    Machine ..|> MachineTimerObserver : implements

    %% Repository pattern
    Transaction --> TransactionRepository : accessed via
    Machine --> MachineRepository : accessed via
    Pricing --> PricingRepository : accessed via
    AdminUser --> AdminUserRepository : accessed via
    AuditLog --> AuditLogRepository : accessed via
    Review --> ReviewRepository : accessed via

    %% Singleton pattern
    Database -- Database : singleton
    ExpressApp -- ExpressApp : singleton

    %% Middleware
    AuthMiddleware --> AdminUser : authenticates
    AuthMiddleware --> JwtPayload : validates
    RateLimitMiddleware --> AuthMiddleware : wraps
    SecurityHeadersMiddleware --> CorsMiddleware : precedes
    InputSanitizer --> Transaction : sanitizes
    ValidationMiddleware --> Transaction : validates

    %% ============================================================
    %% RELATIONSHIPS — Bounded Contexts
    %% ============================================================

    %% Authentication Context
    class AuthenticationContext {
        <<bounded context>>
        +login(username, password): AuthResponse
        +logout(): void
        +verifyToken(token: string): JwtPayload
        +changePassword(current, new): void
        +updateUsername(username, password): void
    }

    %% Order Management Context
    class OrderManagementContext {
        <<bounded context>>
        +createTransaction(data): Transaction
        +createWalkInOrder(data): Transaction
        +updateTransaction(id, data): Transaction
        +deleteTransaction(id): void
        +trackTransaction(ref): Transaction
    }

    %% Machine Management Context
    class MachineManagementContext {
        <<bounded context>>
        +getMachines(): Machine[]
        +createMachine(data): Machine
        +updateMachine(id, data): Machine
        +deleteMachine(id): void
        +resetMachines(): void
    }

    %% Pricing Context
    class PricingContext {
        <<bounded context>>
        +getPricing(): Pricing[]
        +getPublicPricing(): Pricing[]
        +updatePricing(serviceType, data): void
        +getPriceHistory(): PriceHistory[]
        +deletePriceHistory(): void
    }

    %% Customer Context
    class CustomerContext {
        <<bounded context>>
        +getCustomers(page, limit): Customer[]
        +updateCustomer(phone, data): void
        +deleteCustomer(phone): void
    }

    %% Review Context
    class ReviewContext {
        <<bounded context>>
        +getReviews(): Review[]
        +getPublicReviews(): Review[]
        +createReview(data): void
    }

    %% Queue Management Context
    class QueueManagementContext {
        <<bounded context>>
        +getQueueStats(): QueueStats
        +getQueuePredictions(): QueuePrediction[]
        +getOptimalBookingTimes(): OptimalBookingTime[]
    }

    %% Reporting Context
    class ReportingContext {
        <<bounded context>>
        +getStats(): Stats
        +getSalesData(range, serviceType): SalesData
    }

    %% Context relationships
    AuthenticationContext --> AdminUser : manages
    AuthenticationContext --> AuditLog : logs
    AuthenticationContext --> JwtPayload : issues
    OrderManagementContext --> Transaction : manages
    OrderManagementContext --> TransactionItem : manages
    OrderManagementContext --> Machine : assigns
    OrderManagementContext --> QueueEntry : queues
    MachineManagementContext --> Machine : manages
    PricingContext --> Pricing : manages
    PricingContext --> PriceHistory : tracks
    CustomerContext --> Customer : manages
    ReviewContext --> Review : manages
    QueueManagementContext --> QueueEntry : manages
    ReportingContext --> Stats : computes
    ReportingContext --> SalesData : computes
    ReportingContext --> Customer : aggregates

    %% ============================================================
    %% CROSS-CUTTING CONCERNS
    %% ============================================================
    class SecurityConcern {
        <<cross-cutting>>
        +JWT authentication
        +bcrypt password hashing
        +rate limiting
        +CSRF protection
        +XSS sanitization
        +security headers (CSP, HSTS, X-Frame-Options)
        +CORS policy
    }

    class LoggingConcern {
        <<cross-cutting>>
        +HTTP request logging (Morgan)
        +audit trail logging
        +application error logging
        +transaction lifecycle logging
    }

    class TransactionConcern {
        <<cross-cutting>>
        +SQLite ACID transactions
        +retry logic for reference number collisions
        +atomic multi-table updates
    }

    class ValidationConcern {
        <<cross-cutting>>
        +Zod schema validation
        +input sanitization
        +type checking
    }

    %% Cross-cutting to contexts
    SecurityConcern ..> AuthenticationContext : applies to
    SecurityConcern ..> OrderManagementContext : applies to
    SecurityConcern ..> MachineManagementContext : applies to
    SecurityConcern ..> PricingContext : applies to
    LoggingConcern ..> AuthenticationContext : applies to
    LoggingConcern ..> OrderManagementContext : applies to
    LoggingConcern ..> MachineManagementContext : applies to
    LoggingConcern ..> PricingContext : applies to
    TransactionConcern ..> OrderManagementContext : applies to
    TransactionConcern ..> MachineManagementContext : applies to
    ValidationConcern ..> OrderManagementContext : applies to
    ValidationConcern ..> PricingContext : applies to
```

---

## 3. PlantUML Class Diagram

```plantuml
@startuml
!theme plain
skinparam classAttributeIconSize 0
skinparam shadowing false
skinparam roundcorner 10
skinparam padding 2

title HappyWash Laundry Management System — UML Class Diagram

' ============================================================
' VALUE OBJECTS
' ============================================================
package "Value Objects" {
  class Money {
    - amount: number
    - currency: string
    + add(other: Money): Money
    + subtract(other: Money): Money
    + multiply(factor: number): Money
    + format(): String
  }

  class ReferenceNumber {
    - value: String
    - prefix: String
    - timestamp: String
    - random: String
    + toString(): String
    + validate(): Boolean
  }

  class CustomerInfo {
    - name: String
    - phone: String
    - email: String
    + isValid(): Boolean
  }

  class Address {
    - street: String
    - city: String
    - postalCode: String
    + format(): String
  }

  class PhoneNumber {
    - countryCode: String
    - number: String
    + format(): String
    + isValid(): Boolean
  }

  class JwtPayload {
    + userId: String
    + username: String
    + type: String
    + role: String
    + expiresAt: Long
  }

  class PaginationMeta {
    + page: int
    + limit: int
    + total: int
    + totalPages: int
  }

  class PricingConfig {
    + pricing_type: PricingType
    + base_price: double
    + tier_1_limit: int
    + tier_1_price: double
    + tier_2_limit: int
    + tier_2_price: double
    + tier_3_limit: int
    + tier_3_price: double
    + tier_4_limit: int
    + tier_4_price: double
    + tier_5_price_per_kg: double
    + per_kg_price: double
    + is_active: int
    + delivery_fee: double
  }

  class PasswordStrength {
    + score: int
    + feedback: List<String>
    + isValid: Boolean
  }
}

' ============================================================
' ENUMERATIONS
' ============================================================
package "Enumerations" {
  enum TransactionStatus {
    pending
    accepted
    washing
    drying
    ready
    completed
    declined
  }

  enum MachineStatus {
    available
    in_use
    maintenance
  }

  enum MachineType {
    washer
    dryer
    all_in_one
  }

  enum DeliveryMethod {
    pickup
    delivery
  }

  enum PaymentStatus {
    unpaid
    paid
  }

  enum PricingType {
    tiered
    per_kg
  }

  enum AdminRole {
    super_admin
    admin
  }

  enum QueueStatus {
    waiting
    in_progress
    completed
    cancelled
  }

  enum AuditAction {
    login
    logout
    password_change
    username_change
    failed_login
  }
}

' ============================================================
' DOMAIN ENTITIES
' ============================================================
package "Domain Entities" {

  ' --- Transaction Aggregate ---
  class Transaction {
    - id: int
    - referenceNumber: ReferenceNumber
    - customerInfo: CustomerInfo
    - serviceType: String
    - quantity: int
    - specialInstructions: String
    - weight: double
    - appointmentDate: String
    - appointmentTime: String
    - deliveryMethod: DeliveryMethod
    - address: Address
    - status: TransactionStatus
    - totalPrice: Money
    - deliveryFee: Money
    - paymentStatus: PaymentStatus
    - paymentMethod: String
    - handwashProofImage: String
    - createdAt: Date
    - updatedAt: Date
    - deletedAt: Date
    + updateStatus(newStatus: TransactionStatus): void
    + assignMachine(machine: Machine): void
    + unassignMachine(): void
    + calculateTotal(): Money
    + canTransitionTo(status: TransactionStatus): Boolean
    + isHandWash(): Boolean
    + softDelete(): void
  }

  class TransactionItem {
    - id: int
    - serviceType: String
    - quantity: int
    - unitPrice: Money
    - totalPrice: Money
    - createdAt: Date
    + getSubtotal(): Money
  }

  class Review {
    - id: int
    - transactionId: int
    - rating: int
    - comment: String
    - createdAt: Date
    + isValidRating(): Boolean
  }

  class QueueEntry {
    - id: int
    - transactionId: int
    - position: int
    - estimatedWaitTime: int
    - estimatedStartTime: Date
    - estimatedEndTime: Date
    - status: QueueStatus
    - createdAt: Date
    + advancePosition(): void
    + complete(): void
    + cancel(): void
  }

  ' --- Machine Aggregate ---
  class Machine {
    - id: int
    - name: String
    - type: MachineType
    - capacity: int
    - status: MachineStatus
    - remainingTime: int
    - avgCycleTime: int
    - totalJobsCompleted: int
    - isDefault: boolean
    - currentTransactionId: int
    + startCycle(transaction: Transaction): void
    + completeCycle(): void
    + setMaintenance(): void
    + setAvailable(): void
    + decrementTime(): void
    + isAvailable(): Boolean
  }

  ' --- Pricing Aggregate ---
  class Pricing {
    - id: int
    - serviceType: String
    - pricingType: PricingType
    - basePrice: double
    - tier1Limit: int
    - tier1Price: double
    - tier2Limit: int
    - tier2Price: double
    - tier3Limit: int
    - tier3Price: double
    - tier4Limit: int
    - tier4Price: double
    - tier5PricePerKg: double
    - perKgPrice: double
    - isActive: boolean
    - deliveryFee: double
    - updatedAt: Date
    + calculatePrice(quantity: int): Money
    + getDeliveryFee(): Money
    + isActive(): Boolean
    + toConfig(): PricingConfig
  }

  class PriceHistory {
    - id: int
    - serviceType: String
    - oldPriceData: String
    - newPriceData: String
    - changedBy: String
    - createdAt: Date
    + getChanges(): List<PriceChange>
  }

  ' --- Admin / Security Aggregate ---
  class AdminUser {
    - id: int
    - username: String
    - passwordHash: String
    - role: AdminRole
    - lastLogin: Date
    - createdAt: Date
    - updatedAt: Date
    + verifyPassword(password: String): Boolean
    + hasRole(role: AdminRole): Boolean
    + canAccess(resource: String): Boolean
    + updateLastLogin(): void
  }

  class AuditLog {
    - id: int
    - adminId: int
    - action: AuditAction
    - details: String
    - ipAddress: String
    - userAgent: String
    - createdAt: Date
    + log(): void
  }

  ' --- Reporting / Analytics ---
  class Stats {
    + totalOrders: int
    + totalSales: Money
    + pendingOrders: int
  }

  class SalesData {
    + totalOrders: int
    + totalSales: double
    + pendingOrders: int
    + completedOrders: int
    + declinedOrders: int
    + dailySales: List<DailySales>
    + serviceBreakdown: List<ServiceBreakdown>
    + paymentBreakdown: List<PaymentBreakdown>
    + walkInOrders: int
    + walkInSales: double
    + bookingOrders: int
    + bookingSales: double
    + averageOrderValue: double
    + completionRate: double
    + peakHours: List<PeakHour>
    + peakDays: List<PeakDay>
    + topCustomers: List<TopCustomer>
  }

  class Customer {
    - customerName: String
    - customerPhone: String
    - address: Address
    - createdAt: Date
    - totalOrders: int
    - totalSpent: Money
  }
}

' ============================================================
' DESIGN PATTERNS
' ============================================================
package "Design Patterns" {

  ' --- Strategy Pattern ---
  interface PricingStrategy {
    + calculate(config: PricingConfig, quantity: int): double
  }

  class TieredPricingStrategy {
    + calculate(config: PricingConfig, quantity: int): double
  }

  class PerKgPricingStrategy {
    + calculate(config: PricingConfig, quantity: int): double
  }

  class PricingStrategyFactory {
    + create(type: PricingType): PricingStrategy
  }

  ' --- Factory Pattern ---
  class ReferenceNumberFactory {
    + generate(): ReferenceNumber
  }

  class ApiResponseFactory {
    + success~T~(data: T, meta: PaginationMeta): ApiResponse~T~
    + error(message: String): ApiResponse~void~
  }

  ' --- Observer Pattern ---
  class MachineTimer {
    - intervalId: int
    - observers: List<MachineTimerObserver>
    + start(): void
    + stop(): void
    + registerObserver(observer: MachineTimerObserver): void
    + notifyObservers(): void
  }

  interface MachineTimerObserver {
    + onTick(): void
    + onMachineComplete(machine: Machine): void
  }

  ' --- Repository Pattern ---
  class TransactionRepository {
    + findById(id: int): Transaction
    + findByReference(ref: String): Transaction
    + findAll(page: int, limit: int): List<Transaction>
    + save(transaction: Transaction): void
    + update(id: int, data: Object): void
    + delete(id: int): void
    + softDelete(id: int): void
  }

  class MachineRepository {
    + findById(id: int): Machine
    + findAll(): List<Machine>
    + save(machine: Machine): void
    + update(id: int, data: Object): void
    + delete(id: int): void
    + resetAll(): void
  }

  class PricingRepository {
    + findByServiceType(type: String): Pricing
    + findAllActive(): List<Pricing>
    + save(pricing: Pricing): void
    + update(serviceType: String, data: Object): void
    + getHistory(): List<PriceHistory>
  }

  class AdminUserRepository {
    + findByUsername(username: String): AdminUser
    + findById(id: int): AdminUser
    + save(user: AdminUser): void
    + update(id: int, data: Object): void
  }

  class AuditLogRepository {
    + log(entry: AuditLog): void
    + findByAdminId(adminId: int): List<AuditLog>
    + findByAction(action: AuditAction): List<AuditLog>
  }

  class ReviewRepository {
    + findByTransactionId(transactionId: int): Review
    + findAll(): List<Review>
    + save(review: Review): void
  }

  ' --- Middleware / Cross-cutting ---
  class AuthMiddleware {
    + requireAuth(req, res, next): void
    + requireAdmin(req, res, next): void
    + requireSuperAdmin(req, res, next): void
  }

  class RateLimitMiddleware {
    + loginRateLimiter: RateLimiter
    + apiRateLimiter: RateLimiter
    + publicRateLimiter: RateLimiter
  }

  class SecurityHeadersMiddleware {
    + applySecurityHeaders(req, res, next): void
  }

  class CorsMiddleware {
    + applyCors(req, res, next): void
  }

  class InputSanitizer {
    + sanitizeInput(str: String): String
  }

  class ValidationMiddleware {
    + transactionSchema: ZodSchema
    + loginSchema: ZodSchema
    + machineUpdateSchema: ZodSchema
    + pricingUpdateSchema: ZodSchema
  }

  ' --- Singleton ---
  class Database {
    - instance: Database
    - db: Database
    + getInstance(): Database
    + prepare(query: String): Statement
    + exec(query: String): void
    + transaction(fn: Function): Transaction
  }

  class ExpressApp {
    - instance: ExpressApp
    + getInstance(): ExpressApp
    + use(middleware): void
    + get(path, handler): void
    + post(path, handler): void
    + patch(path, handler): void
    + delete(path, handler): void
  }
}

' ============================================================
' BOUNDED CONTEXTS
' ============================================================
package "Bounded Contexts" {

  class AuthenticationContext <<bounded context>> {
    + login(username, password): AuthResponse
    + logout(): void
    + verifyToken(token: String): JwtPayload
    + changePassword(current, new): void
    + updateUsername(username, password): void
  }

  class OrderManagementContext <<bounded context>> {
    + createTransaction(data): Transaction
    + createWalkInOrder(data): Transaction
    + updateTransaction(id, data): Transaction
    + deleteTransaction(id): void
    + trackTransaction(ref): Transaction
  }

  class MachineManagementContext <<bounded context>> {
    + getMachines(): List<Machine>
    + createMachine(data): Machine
    + updateMachine(id, data): Machine
    + deleteMachine(id): void
    + resetMachines(): void
  }

  class PricingContext <<bounded context>> {
    + getPricing(): List<Pricing>
    + getPublicPricing(): List<Pricing>
    + updatePricing(serviceType, data): void
    + getPriceHistory(): List<PriceHistory>
    + deletePriceHistory(): void
  }

  class CustomerContext <<bounded context>> {
    + getCustomers(page, limit): List<Customer>
    + updateCustomer(phone, data): void
    + deleteCustomer(phone): void
  }

  class ReviewContext <<bounded context>> {
    + getReviews(): List<Review>
    + getPublicReviews(): List<Review>
    + createReview(data): void
  }

  class QueueManagementContext <<bounded context>> {
    + getQueueStats(): QueueStats
    + getQueuePredictions(): List<QueuePrediction>
    + getOptimalBookingTimes(): List<OptimalBookingTime>
  }

  class ReportingContext <<bounded context>> {
    + getStats(): Stats
    + getSalesData(range, serviceType): SalesData
  }
}

' ============================================================
' CROSS-CUTTING CONCERNS
' ============================================================
package "Cross-Cutting Concerns" {

  class SecurityConcern <<cross-cutting>> {
    + JWT authentication
    + bcrypt password hashing
    + rate limiting
    + CSRF protection
    + XSS sanitization
    + security headers (CSP, HSTS, X-Frame-Options)
    + CORS policy
  }

  class LoggingConcern <<cross-cutting>> {
    + HTTP request logging (Morgan)
    + audit trail logging
    + application error logging
    + transaction lifecycle logging
  }

  class TransactionConcern <<cross-cutting>> {
    + SQLite ACID transactions
    + retry logic for reference number collisions
    + atomic multi-table updates
  }

  class ValidationConcern <<cross-cutting>> {
    + Zod schema validation
    + input sanitization
    + type checking
  }
}

' ============================================================
' RELATIONSHIPS — Domain Entities
' ============================================================

' Transaction aggregate composition
Transaction "1" *-- "0..*" TransactionItem : contains
Transaction "1" o-- "0..1" Review : has
Transaction "1" --> "0..1" Machine : assigned to
Transaction "1" o-- "0..1" QueueEntry : queued in

' Pricing aggregate
Pricing "1" o-- "0..*" PriceHistory : tracks

' Admin aggregate
AdminUser "1" o-- "0..*" AuditLog : generates

' Value object usage
Transaction --> ReferenceNumber : uses
Transaction --> CustomerInfo : uses
Transaction --> Address : uses
Transaction --> Money : uses
Transaction --> PhoneNumber : uses
TransactionItem --> Money : uses
Pricing --> PricingConfig : converts to
Pricing --> Money : uses
PriceHistory --> Pricing : references by serviceType
AuditLog --> AdminUser : references by adminId
Customer --> Money : uses
Customer --> Address : uses
AdminUser --> PasswordStrength : validates with
JwtPayload --> AdminUser : derived from

' ============================================================
' RELATIONSHIPS — Design Patterns
' ============================================================

' Strategy pattern
PricingStrategy <|.. TieredPricingStrategy
PricingStrategy <|.. PerKgPricingStrategy
PricingStrategyFactory ..> PricingStrategy : creates
PricingStrategyFactory ..> TieredPricingStrategy : creates
PricingStrategyFactory ..> PerKgPricingStrategy : creates
Pricing --> PricingStrategy : delegates to

' Factory pattern
ReferenceNumberFactory ..> ReferenceNumber : creates
Transaction --> ReferenceNumberFactory : uses
ApiResponseFactory ..> PaginationMeta : uses

' Observer pattern
MachineTimer o-- MachineTimerObserver : observes
MachineTimer --> Machine : monitors
Machine ..|> MachineTimerObserver : implements

' Repository pattern
Transaction --> TransactionRepository : accessed via
Machine --> MachineRepository : accessed via
Pricing --> PricingRepository : accessed via
AdminUser --> AdminUserRepository : accessed via
AuditLog --> AuditLogRepository : accessed via
Review --> ReviewRepository : accessed via

' Singleton pattern
Database -- Database : singleton
ExpressApp -- ExpressApp : singleton

' Middleware
AuthMiddleware --> AdminUser : authenticates
AuthMiddleware --> JwtPayload : validates
RateLimitMiddleware --> AuthMiddleware : wraps
SecurityHeadersMiddleware --> CorsMiddleware : precedes
InputSanitizer --> Transaction : sanitizes
ValidationMiddleware --> Transaction : validates

' ============================================================
' RELATIONSHIPS — Bounded Contexts
' ============================================================

AuthenticationContext --> AdminUser : manages
AuthenticationContext --> AuditLog : logs
AuthenticationContext --> JwtPayload : issues
OrderManagementContext --> Transaction : manages
OrderManagementContext --> TransactionItem : manages
OrderManagementContext --> Machine : assigns
OrderManagementContext --> QueueEntry : queues
MachineManagementContext --> Machine : manages
PricingContext --> Pricing : manages
PricingContext --> PriceHistory : tracks
CustomerContext --> Customer : manages
ReviewContext --> Review : manages
QueueManagementContext --> QueueEntry : manages
ReportingContext --> Stats : computes
ReportingContext --> SalesData : computes
ReportingContext --> Customer : aggregates

' ============================================================
' RELATIONSHIPS — Cross-Cutting Concerns
' ============================================================

SecurityConcern ..> AuthenticationContext : applies to
SecurityConcern ..> OrderManagementContext : applies to
SecurityConcern ..> MachineManagementContext : applies to
SecurityConcern ..> PricingContext : applies to
LoggingConcern ..> AuthenticationContext : applies to
LoggingConcern ..> OrderManagementContext : applies to
LoggingConcern ..> MachineManagementContext : applies to
LoggingConcern ..> PricingContext : applies to
TransactionConcern ..> OrderManagementContext : applies to
TransactionConcern ..> MachineManagementContext : applies to
ValidationConcern ..> OrderManagementContext : applies to
ValidationConcern ..> PricingContext : applies to

@enduml
```

---

## 4. Architectural Rationale

### 4.1 Domain-Driven Design & Aggregate Design

The system is organized around four primary **aggregate roots**: `Transaction`, `Machine`, `Pricing`, and `AdminUser`. Each aggregate encapsulates its own consistency boundary and enforces invariants through its root entity.

**Transaction as Aggregate Root** (`server.ts:55-75`, `src/types/index.ts:57-81`): The `Transaction` entity is the central domain object. It owns `TransactionItem` entities through **composition** (lifetime tied to the parent — items are deleted when the transaction is deleted, as seen in `server.ts:1714`). The `Review` entity is linked via **aggregation** (it can exist independently but is semantically tied to a transaction). The `QueueEntry` is also an aggregation — it references a transaction but can be managed independently for queue reordering.

The decision to model `TransactionItem` as a separate entity rather than embedding items as a JSON array was driven by the need for **queryability** — the admin dashboard needs to filter, sort, and report on individual service items (`server.ts:1512-1526` shows a batch query for items). This also supports the **multi-order** feature where a single transaction can contain multiple service types with different quantities.

**Machine as Aggregate Root** (`server.ts:77-84`): Machines are modeled as independent aggregates because they have their own lifecycle (status transitions, time counting) that is managed by the background timer (`server.ts:2472-2558`). The `current_transaction_id` field creates a **bidirectional association** — the machine knows which transaction it's processing, and the transaction knows which machine it's assigned to. This dual reference is necessary because the timer needs to update transaction status when a machine cycle completes, and the transaction update logic needs to reset machine status.

**Pricing as Aggregate Root** (`server.ts:205-225`): Pricing configurations are versioned through `PriceHistory` entries. The `Pricing` entity owns its history records through composition — when a pricing record is updated, a new `PriceHistory` entry is created (`server.ts:2099-2108`). This provides a full audit trail of pricing changes, which is critical for a business that needs to justify price adjustments to customers.

### 4.2 Strategy Pattern for Pricing Calculation

The pricing system uses the **Strategy pattern** to support two distinct pricing models: tiered pricing (for "Wash & Fold") and per-kg pricing (for comforters, bedding, hand wash). The `PricingStrategy` interface (`src/utils/sharedPricing.ts:45-58`) defines the contract, with `TieredPricingStrategy` and `PerKgPricingStrategy` as concrete implementations.

The `PricingStrategyFactory` selects the appropriate strategy based on the `pricing_type` field. This design was chosen because:

1. **Extensibility**: New pricing models (e.g., subscription-based, seasonal discounts) can be added without modifying existing code.
2. **Testability**: Each strategy can be unit-tested independently.
3. **Single Responsibility**: The pricing calculation logic is separated from the data model.

The `PricingConfig` value object serves as the strategy's input, ensuring that pricing rules are immutable and can be safely shared between the frontend and backend (`src/utils/sharedPricing.ts:6-21`).

### 4.3 Repository Pattern for Data Access

The system uses the **Repository pattern** to abstract database access. Each aggregate root has a corresponding repository (`TransactionRepository`, `MachineRepository`, `PricingRepository`, `AdminUserRepository`, `AuditLogRepository`, `ReviewRepository`). In the current implementation, these are realized as inline SQL queries within `server.ts`, but the pattern is evident in the consistent query structure and the separation of data access logic from business logic.

The `Database` class is a **Singleton** (`server.ts:47`) — a single SQLite connection is shared across the entire application. This is appropriate for SQLite, which is an embedded database, and avoids the overhead of connection pooling.

### 4.4 Observer Pattern for Machine Timer

The background machine timer (`server.ts:2472-2558`) implements the **Observer pattern**. The `MachineTimer` acts as the subject, and `Machine` entities act as observers. Every second, the timer decrements `remaining_time` for all in-use machines and notifies them when a cycle completes. When a machine's cycle finishes, the timer transitions the associated transaction's status (washing → drying → ready) and releases the machine.

This design decouples the timing mechanism from the machine state logic, allowing the timer to be started/stopped independently and making it easy to add new observers (e.g., notification services) in the future.

### 4.5 Factory Pattern for Reference Numbers and API Responses

The `ReferenceNumberFactory` generates unique reference numbers using a timestamp + random component (`server.ts:507-512`). This ensures uniqueness while remaining human-readable. The retry logic in transaction creation (`server.ts:1000-1136`) handles the rare case of collisions.

The `ApiResponseFactory` standardizes all API responses with a consistent envelope (`server.ts:515-523`), including success status, data, error messages, pagination metadata, and timestamps. This provides a uniform contract for the frontend to consume.

### 4.6 Bounded Contexts

The system is divided into eight **bounded contexts**, each representing a distinct business capability:

1. **Authentication Context** — Manages admin login, logout, token verification, password changes, and username updates. Uses JWT for stateless authentication and bcrypt for password hashing. Audit logs are generated for all authentication events.

2. **Order Management Context** — Handles transaction creation (both public booking and admin walk-in), status updates, deletion, and tracking. This is the most complex context, involving pricing calculation, machine assignment, queue management, and handwash proof validation.

3. **Machine Management Context** — Manages machine CRUD operations, status updates, and the reset functionality. The background timer is part of this context.

4. **Pricing Context** — Manages pricing configuration, price history, and public pricing access. Pricing updates are audited and versioned.

5. **Customer Context** — Provides customer aggregation (derived from transactions), customer updates, and soft-delete functionality. Customers are not stored as separate records but are derived from transaction data, reducing data redundancy.

6. **Review Context** — Handles review submission (public) and retrieval (admin and public). Reviews are linked to transactions via foreign key.

7. **Queue Management Context** — Manages queue entries, predictions, and optimal booking time calculations. Currently partially implemented (queue table exists but manual machine assignment is used).

8. **Reporting Context** — Provides sales reports, statistics, and analytics. This context aggregates data from multiple other contexts.

### 4.7 Cross-Cutting Concerns

**Security** (`server.ts:570-677`): The system implements multiple layers of security:
- **JWT Authentication**: Stateless token-based auth with 24-hour expiry (`server.ts:770-774`)
- **bcrypt Password Hashing**: Passwords are hashed with salt rounds of 10 (`server.ts:44, 760`)
- **Rate Limiting**: Three separate rate limiters for login (5/15min), API (500/min), and public endpoints (30/15min) (`server.ts:544-568`)
- **CSRF Protection**: Cookie-based auth with `sameSite=strict` (`server.ts:666-677`)
- **XSS Prevention**: Input sanitization strips HTML/JS (`server.ts:966-968`)
- **Security Headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (`server.ts:652-664`)
- **CORS**: Whitelist-based origin checking (`server.ts:637-650`)
- **Role-Based Access Control**: `requireAuth`, `requireAdmin`, `requireSuperAdmin` middleware (`server.ts:571-607`)

**Logging** (`server.ts:630, 726-737`): Three logging mechanisms:
- **Morgan**: HTTP request logging in short format
- **Audit Logs**: Structured logging of admin actions (login, logout, password changes, username changes, failed logins)
- **Console Logging**: Application-level logging for debugging and monitoring

**Transactions** (`server.ts:1004, 1191, 1113`): SQLite ACID transactions ensure atomicity for multi-table operations (transaction creation, machine assignment, queue insertion). Retry logic handles reference number collisions.

**Validation** (`server.ts:400-440`): Zod schemas validate all incoming data at the API boundary, preventing invalid data from reaching the database.

### 4.8 Frontend Architecture

The frontend (`src/App.tsx`, `src/components/admin/AdminDashboard.tsx`) follows a component-based architecture with:
- **View State Management**: A central `View` type controls which screen is displayed
- **API Client Layer** (`src/utils/api.ts`): Abstracts all HTTP communication with the backend
- **Shared Pricing Logic** (`src/utils/sharedPricing.ts`): Eliminates pricing calculation duplication between frontend and backend
- **Error Boundary** (`src/components/ErrorBoundary.tsx`): Catches React rendering errors and displays a fallback UI
- **Receipt Component** (`src/components/Receipt.tsx`): Generates printable receipts for transactions

### 4.9 Key Design Decisions

1. **Soft Delete for Transactions**: Transactions are soft-deleted (`deleted_at` column) rather than hard-deleted, preserving audit trails and allowing recovery (`server.ts:121, 2377-2406`).

2. **Hand Wash Special Handling**: Hand wash orders cannot be assigned to machines and require proof images before entering the washing state (`server.ts:990-992, 1585-1590, 1758-1762`). This business rule is enforced at both the API and domain levels.

3. **Multi-Item Transaction Support**: Transactions can contain multiple items with different service types, with tiered pricing applied per service type (`server.ts:1013-1036`). This supports customers who want to wash different types of items in a single order.

4. **Machine-Transaction Bidirectional Link**: The `current_transaction_id` on machines and `machine_id` on transactions create a bidirectional association, enabling the timer to update transaction status and the transaction update logic to reset machine status.

5. **Pricing Fallback Strategy**: When the database is unavailable, the system falls back to hardcoded pricing values (`src/utils/sharedPricing.ts:140-237`), ensuring the application remains functional.

6. **Queue Table for Future Use**: The queue table exists in the schema but is not actively used for machine assignment (manual assignment is used instead). The table is maintained for potential future smart queue implementation (`server.ts:155-176`).
